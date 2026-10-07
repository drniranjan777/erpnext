import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parties } from '@nextgen/database';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { StockEntriesService } from '../inventory/stock-entries.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createRequisitionSchema } from '../purchase/requisitions.schemas';
import { RequisitionsService } from '../purchase/requisitions.service';
import { TicketsService } from '../service/tickets.service';

export interface ActionHandler {
  /** Permission the person approving (or the agent's actor) must hold. */
  permission: string;
  run(auth: AuthContext, params: Record<string, unknown>, meta: RequestMeta): Promise<Record<string, unknown>>;
}

/**
 * What agents may do, each through the same service a person would use, so the usual
 * validations, numbering, approvals and audit apply. Agents only ever create drafts or send
 * messages; nothing here posts stock or money.
 */
@Injectable()
export class AgentActions {
  private readonly handlers = new Map<string, ActionHandler>();

  constructor(
    private readonly database: DatabaseService,
    requisitions: RequisitionsService,
    stockEntries: StockEntriesService,
    private readonly notifications: NotificationsService,
    tickets: TicketsService,
  ) {
    this.register('create_requisition', {
      permission: 'purchase.requisitions.manage',
      run: async (auth, params, meta) => {
        const pr = (await requisitions.create(auth, createRequisitionSchema.parse(params), meta)) as { id: string; status: string };
        return { documentType: 'purchase_requisition', id: pr.id, status: pr.status, link: `/purchase/requisitions/${pr.id}` };
      },
    });
    this.register('draft_stock_transfer', {
      permission: 'inventory.entries.manage',
      run: async (auth, params, meta) => {
        const p = params as { fromWarehouseId: string; toWarehouseId: string; reason: string; lines: { itemId: string; qty: number }[] };
        const e = (await stockEntries.create(auth, { purpose: 'transfer', fromWarehouseId: p.fromWarehouseId, toWarehouseId: p.toWarehouseId, reason: p.reason, lines: p.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), rate: null })) } as Parameters<StockEntriesService['create']>[1], meta)) as { id: string };
        return { documentType: 'stock_entry', id: e.id, status: 'draft', link: `/inventory/stock-entries/${e.id}` };
      },
    });
    this.register('reply_ticket', {
      permission: 'service.tickets.manage',
      run: async (auth, params) => {
        const p = params as { ticketId: string; body: string };
        const r = (await tickets.reply(auth, p.ticketId, { body: p.body, toCustomer: true })) as { mailed: boolean };
        return { ticketId: p.ticketId, mailed: r.mailed, link: `/service/tickets/${p.ticketId}` };
      },
    });
    this.register('email_party', {
      permission: 'ai.inbox.use',
      run: async (auth, params) => {
        const p = params as { partyId: string; subject: string; body: string };
        return this.database.run(auth, async (tx) => {
          const [party] = await tx.select({ name: parties.name, email: parties.email }).from(parties).where(eq(parties.id, p.partyId));
          if (!party) throw new NotFoundException('Party not found');
          if (!party.email) throw new BadRequestException(`${party.name} has no email address`);
          await this.notifications.notify(tx, auth.tenantId, 'agent.message', [{ email: String(party.email), name: party.name }], { subject: p.subject, body: p.body });
          return { sentTo: String(party.email) };
        });
      },
    });
  }

  register(type: string, handler: ActionHandler) {
    this.handlers.set(type, handler);
  }

  get(type: string) {
    const h = this.handlers.get(type);
    if (!h) throw new BadRequestException(`Unknown action ${type}`);
    return h;
  }

  types() {
    return [...this.handlers.entries()].map(([type, h]) => ({ type, permission: h.permission }));
  }
}

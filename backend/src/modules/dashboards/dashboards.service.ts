import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { dashboards } from '@nextgen/database';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import { DatabaseService } from '../../database/database.service';
import { PRESETS, WIDGETS, type WidgetDef } from './widgets';

export const dashboardSchema = z.object({
  name: z.string().trim().min(2).max(60),
  preset: z.string().max(30).nullable().optional(),
  widgets: z
    .array(z.object({ key: z.string().max(60), size: z.union([z.literal(1), z.literal(2), z.literal(3)]) }))
    .min(1, 'Add at least one widget')
    .max(30),
  shared: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  refreshSeconds: z.number().int().min(15).max(3600).default(60),
});
export type DashboardInput = z.infer<typeof dashboardSchema>;

/** Preset tried first for a home dashboard, by what the user can see. */
const HOME_ORDER = ['owner', 'plant', 'finance', 'sales', 'purchase', 'stores', 'production', 'qa'];

/**
 * Dashboards: role presets and saved layouts of widgets. Each widget checks its own
 * permission and is computed in its own savepoint, so one failing widget never blanks the
 * rest of the page.
 */
@Injectable()
export class DashboardsService {
  constructor(private readonly database: DatabaseService) {}

  private async perms(auth: AuthContext) {
    return auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
  }

  private visible(perms: Set<string>) {
    return WIDGETS.filter((w) => !w.permission || perms.has(w.permission));
  }

  private describe(w: WidgetDef) {
    return { key: w.key, title: w.title, description: w.description, area: w.area, size: w.size, href: w.href };
  }

  async widgets(auth: AuthContext) {
    return this.visible(await this.perms(auth)).map((w) => this.describe(w));
  }

  /** Presets the user can use, and saved dashboards (their own and shared ones). */
  async list(auth: AuthContext) {
    const perms = await this.perms(auth);
    const seen = new Set(this.visible(perms).map((w) => w.key));
    const presets = Object.entries(PRESETS)
      .map(([key, p]) => ({ key, name: p.name, widgets: p.widgets.filter((k) => seen.has(k)).length }))
      .filter((p) => p.widgets >= Math.min(3, PRESETS[p.key].widgets.length));
    const saved = await this.database.run(auth, (tx) =>
      tx
        .select({ id: dashboards.id, name: dashboards.name, preset: dashboards.preset, shared: isNull(dashboards.ownerId), isDefault: dashboards.isDefault, ownerId: dashboards.ownerId })
        .from(dashboards)
        .where(or(eq(dashboards.ownerId, auth.userId), isNull(dashboards.ownerId)))
        .orderBy(asc(dashboards.name)),
    );
    return { presets, saved: saved.map(({ ownerId, ...d }) => ({ ...d, mine: ownerId === auth.userId })) };
  }

  /** A dashboard with its widgets computed: a saved one, a preset, or the user's home. */
  async view(auth: AuthContext, q: { id?: string; preset?: string }) {
    const perms = await this.perms(auth);
    const allowed = new Map(this.visible(perms).map((w) => [w.key, w]));
    let head: { id: string | null; name: string; preset: string | null; refreshSeconds: number; mine: boolean; shared: boolean; isDefault: boolean };
    let layout: { key: string; size: 1 | 2 | 3 }[];
    const fromPreset = (key: string) => {
      const p = PRESETS[key];
      if (!p) throw new NotFoundException('No such dashboard');
      head = { id: null, name: p.name, preset: key, refreshSeconds: key === 'tv' ? 30 : 60, mine: false, shared: false, isDefault: false };
      layout = p.widgets.map((k) => ({ key: k, size: allowed.get(k)?.size ?? 1 }));
    };
    if (q.id) {
      const [d] = await this.database.run(auth, (tx) => tx.select().from(dashboards).where(and(eq(dashboards.id, q.id!), or(eq(dashboards.ownerId, auth.userId), isNull(dashboards.ownerId)))));
      if (!d) throw new NotFoundException('Dashboard not found');
      head = { id: d.id, name: d.name, preset: d.preset, refreshSeconds: d.refreshSeconds, mine: d.ownerId === auth.userId, shared: d.ownerId === null, isDefault: d.isDefault };
      layout = d.widgets;
    } else if (q.preset) fromPreset(q.preset);
    else {
      const [mine] = await this.database.run(auth, (tx) => tx.select().from(dashboards).where(and(eq(dashboards.ownerId, auth.userId), eq(dashboards.isDefault, true))).limit(1));
      if (mine) {
        head = { id: mine.id, name: mine.name, preset: mine.preset, refreshSeconds: mine.refreshSeconds, mine: true, shared: false, isDefault: true };
        layout = mine.widgets;
      } else {
        // The first preset the user can see most of.
        const best = HOME_ORDER.find((k) => PRESETS[k].widgets.filter((w) => allowed.has(w)).length >= Math.ceil(PRESETS[k].widgets.length * 0.75));
        if (best) fromPreset(best);
        else {
          head = { id: null, name: 'My dashboard', preset: null, refreshSeconds: 60, mine: false, shared: false, isDefault: false };
          layout = [...allowed.values()].slice(0, 8).map((w) => ({ key: w.key, size: w.size }));
        }
      }
    }
    const today = todayIST();
    const ctx = { auth, today, monthStart: `${today.slice(0, 8)}01` };
    const widgets = await this.database.run(auth, async (tx) => {
      const out = [];
      for (const item of layout!) {
        const w = allowed.get(item.key);
        if (!w) continue;
        try {
          const data = await tx.transaction((sp) => w.compute(sp, ctx));
          out.push({ ...this.describe(w), size: item.size, data });
        } catch {
          out.push({ ...this.describe(w), size: item.size, data: null, error: 'Could not load this widget' });
        }
      }
      return out;
    });
    return { ...head!, asOf: new Date().toISOString(), widgets };
  }

  async save(auth: AuthContext, id: string | null, input: DashboardInput) {
    const perms = await this.perms(auth);
    if (input.shared && !perms.has('platform.customization.manage')) throw new ForbiddenException('Only administrators can share dashboards with everyone');
    const known = new Set(WIDGETS.map((w) => w.key));
    const widgets = input.widgets.filter((w) => known.has(w.key));
    return this.database.run(auth, async (tx) => {
      if (id) {
        const [d] = await tx.select().from(dashboards).where(eq(dashboards.id, id));
        if (!d) throw new NotFoundException('Dashboard not found');
        if (d.ownerId !== auth.userId && !(d.ownerId === null && perms.has('platform.customization.manage'))) throw new ForbiddenException('You cannot change this dashboard');
      }
      const owner = input.shared ? null : auth.userId;
      if (input.isDefault && owner) await tx.update(dashboards).set({ isDefault: false }).where(eq(dashboards.ownerId, owner));
      const values = { name: input.name, preset: input.preset ?? null, widgets, ownerId: owner, isDefault: !!owner && input.isDefault, refreshSeconds: input.refreshSeconds, updatedBy: auth.userId };
      if (id) {
        await tx.update(dashboards).set({ ...values, updatedAt: new Date() }).where(eq(dashboards.id, id));
        return { id };
      }
      const [row] = await tx.insert(dashboards).values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId }).returning({ id: dashboards.id });
      return row;
    });
  }

  async remove(auth: AuthContext, id: string) {
    const perms = await this.perms(auth);
    return this.database.run(auth, async (tx) => {
      const [d] = await tx.select().from(dashboards).where(eq(dashboards.id, id));
      if (!d) throw new NotFoundException('Dashboard not found');
      if (d.ownerId !== auth.userId && !(d.ownerId === null && perms.has('platform.customization.manage'))) throw new ForbiddenException('You cannot delete this dashboard');
      await tx.delete(dashboards).where(eq(dashboards.id, id));
    });
  }
}

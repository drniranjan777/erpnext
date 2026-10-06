import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { branches, companies } from '@nextgen/database';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import type { CreateCompanyInput, UpdateCompanyInput } from './org.schemas';

@Injectable()
export class OrgService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  listCompanies(auth: AuthContext) {
    // No tenant filter needed here: RLS restricts rows to the caller's tenant.
    return this.database.run(auth, (tx) =>
      tx.select().from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.name)),
    );
  }

  createCompany(auth: AuthContext, input: CreateCompanyInput, requestId?: string) {
    const gstin = input.gstin ?? null;
    return this.database.run(auth, async (tx) => {
      await this.entitlements.assertLimit(tx, auth.tenantId, 'companies');
      const [company] = await tx
        .insert(companies)
        .values({
          tenantId: auth.tenantId,
          name: input.name,
          legalName: input.legalName ?? input.name,
          gstin,
          pan: gstin ? gstin.slice(2, 12) : null,
          stateCode: gstin ? gstin.slice(0, 2) : (input.address?.stateCode ?? null),
          address: input.address ?? {},
          fyStartMonth: input.fyStartMonth,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })
        .returning();
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'org.company.created',
        entityType: 'company',
        entityId: company.id,
        changes: this.audit.diff({}, { name: company.name, gstin: company.gstin }),
        requestId,
      });
      return company;
    });
  }

  updateCompany(auth: AuthContext, id: string, input: UpdateCompanyInput, requestId?: string) {
    const gstin = input.gstin ?? null;
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(companies).where(and(eq(companies.id, id), isNull(companies.deletedAt))).for('update');
      if (!before) throw new NotFoundException('Company not found');
      if (gstin) {
        const [clash] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.gstin, gstin), ne(companies.id, id)));
        if (clash) throw new ConflictException('Another company in this workspace already has this GSTIN');
      }
      const [company] = await tx
        .update(companies)
        .set({
          name: input.name,
          legalName: input.legalName ?? input.name,
          gstin,
          pan: gstin ? gstin.slice(2, 12) : before.pan,
          stateCode: gstin ? gstin.slice(0, 2) : (input.address?.stateCode ?? before.stateCode),
          address: input.address ?? before.address,
          updatedBy: auth.userId,
        })
        .where(eq(companies.id, id))
        .returning();
      const changes = this.audit.diff({ name: before.name, gstin: before.gstin, stateCode: before.stateCode }, { name: company.name, gstin: company.gstin, stateCode: company.stateCode });
      if (Object.keys(changes).length) {
        await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'org.company.updated', entityType: 'company', entityId: id, changes, requestId });
      }
      return company;
    });
  }

  listBranches(auth: AuthContext, companyId?: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select()
        .from(branches)
        .where(and(isNull(branches.deletedAt), companyId ? eq(branches.companyId, companyId) : undefined))
        .orderBy(asc(branches.code)),
    );
  }
}

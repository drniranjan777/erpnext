import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { companies, machines, tools, warehouses, workCenters } from '@nextgen/database';
import { asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { decimalSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';

export const workCenterSchema = z.object({
  companyId: z.uuid().optional(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['machine', 'line', 'manual', 'subcontract']).default('machine'),
  warehouseId: z.uuid().nullable().optional(),
  hoursPerDay: decimalSchema(2, 'Hours per day').transform((v) => v ?? '8'),
  units: z.number().int().min(1).max(500).default(1),
  efficiencyPct: decimalSchema(2, 'Efficiency').transform((v) => v ?? '100'),
  labourRate: decimalSchema(4, 'Labour rate').transform((v) => v ?? '0'),
  machineRate: decimalSchema(4, 'Machine rate').transform((v) => v ?? '0'),
  overheadRate: decimalSchema(4, 'Overhead rate').transform((v) => v ?? '0'),
  isActive: z.boolean().default(true),
});
export const machineSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  workCenterId: z.uuid(),
  make: optionalText(80),
  model: optionalText(80),
  serialNo: optionalText(80),
  capacity: optionalText(80),
  /** Process equipment cleaned before each batch. */
  requiresCleaning: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const toolSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['mould', 'die', 'fixture', 'gauge', 'tool']).default('mould'),
  cavities: z.number().int().min(1).max(512).default(1),
  lifeShots: z.number().int().min(1).nullable().optional(),
  maintenanceEvery: z.number().int().min(1).nullable().optional(),
  machineId: z.uuid().nullable().optional(),
  status: z.enum(['available', 'in_use', 'maintenance', 'retired']).default('available'),
});

/** Work centres (capacity and hourly cost rates), machines, and tools with shot-life tracking. */
@Injectable()
export class ResourcesService {
  constructor(private readonly database: DatabaseService) {}

  workCenters(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(workCenters).orderBy(asc(workCenters.code)));
  }

  saveWorkCenter(auth: AuthContext, id: string | null, input: z.infer<typeof workCenterSchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = input.companyId ?? (await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1))[0].id;
      const { companyId: _c, ...values } = input;
      if (id) {
        const [row] = await tx.update(workCenters).set({ ...values, warehouseId: values.warehouseId ?? null, updatedBy: auth.userId }).where(eq(workCenters.id, id)).returning();
        if (!row) throw new NotFoundException('Work centre not found');
        return row;
      }
      const [dup] = await tx.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.code, input.code));
      if (dup) throw new ConflictException({ message: `Code ${input.code} is already used`, errors: [{ path: 'code', message: 'Already used' }] });
      if (values.warehouseId) {
        const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, values.warehouseId));
        if (!wh) throw new NotFoundException('Warehouse not found');
      }
      const [row] = await tx.insert(workCenters).values({ ...values, warehouseId: values.warehouseId ?? null, tenantId: auth.tenantId, companyId, createdBy: auth.userId, updatedBy: auth.userId }).returning();
      return row;
    });
  }

  machines(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select({ m: machines, workCenter: workCenters.code }).from(machines).innerJoin(workCenters, eq(workCenters.id, machines.workCenterId)).orderBy(asc(machines.code)).then((r) => r.map(({ m, workCenter }) => ({ ...m, workCenter }))));
  }

  saveMachine(auth: AuthContext, id: string | null, input: z.infer<typeof machineSchema>) {
    return this.database.run(auth, async (tx) => {
      if (id) {
        const [row] = await tx.update(machines).set({ ...input, updatedBy: auth.userId }).where(eq(machines.id, id)).returning();
        if (!row) throw new NotFoundException('Machine not found');
        return row;
      }
      const [dup] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.code, input.code));
      if (dup) throw new ConflictException({ message: `Code ${input.code} is already used`, errors: [{ path: 'code', message: 'Already used' }] });
      const [row] = await tx.insert(machines).values({ ...input, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId }).returning();
      return row;
    });
  }

  tools(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(tools).orderBy(asc(tools.code));
      return rows.map((t) => ({
        ...t,
        lifeUsedPct: t.lifeShots ? Math.round((t.shotsUsed / t.lifeShots) * 1000) / 10 : null,
        maintenanceDue: !!t.maintenanceEvery && t.shotsUsed - t.lastMaintenanceAt >= t.maintenanceEvery,
      }));
    });
  }

  saveTool(auth: AuthContext, id: string | null, input: z.infer<typeof toolSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, lifeShots: input.lifeShots ?? null, maintenanceEvery: input.maintenanceEvery ?? null, machineId: input.machineId ?? null };
      if (id) {
        const [row] = await tx.update(tools).set({ ...values, updatedBy: auth.userId }).where(eq(tools.id, id)).returning();
        if (!row) throw new NotFoundException('Tool not found');
        return row;
      }
      const [dup] = await tx.select({ id: tools.id }).from(tools).where(eq(tools.code, input.code));
      if (dup) throw new ConflictException({ message: `Code ${input.code} is already used`, errors: [{ path: 'code', message: 'Already used' }] });
      const [row] = await tx.insert(tools).values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId }).returning();
      return row;
    });
  }

  /** Maintenance done: the counter since the last service starts again. */
  toolMaintained(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(tools).where(eq(tools.id, id));
      if (!t) throw new NotFoundException('Tool not found');
      const [row] = await tx.update(tools).set({ lastMaintenanceAt: t.shotsUsed, status: t.status === 'maintenance' ? 'available' : t.status, updatedBy: auth.userId }).where(eq(tools.id, id)).returning();
      return row;
    });
  }
}

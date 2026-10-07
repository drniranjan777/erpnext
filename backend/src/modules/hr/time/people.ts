import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { employees, type Transaction } from '@nextgen/database';
import { and, eq, ne } from 'drizzle-orm';
import type { AuthContext } from '../../../common/auth-context';
import { loadPermissions } from '../../../common/guards';
import type { DatabaseService } from '../../../database/database.service';

export async function permissionsOf(database: DatabaseService, auth: AuthContext) {
  return auth.permissions ?? (await loadPermissions(database, auth.tenantId, auth.userId, auth.membershipId));
}

/** The employee record linked to the signed-in user, if any. */
export async function selfEmployee(tx: Transaction, auth: AuthContext) {
  const [e] = await tx
    .select({ id: employees.id, code: employees.code, fullName: employees.fullName, locationId: employees.locationId, reportsToId: employees.reportsToId, gender: employees.gender })
    .from(employees)
    .where(and(eq(employees.userId, auth.userId), ne(employees.status, 'exited')))
    .limit(1);
  return e ?? null;
}

export async function requireSelf(tx: Transaction, auth: AuthContext) {
  const e = await selfEmployee(tx, auth);
  if (!e) throw new ForbiddenException('Your login is not linked to an employee record. Ask HR to link it.');
  return e;
}

/** True when the signed-in user is the employee's reporting manager. */
export async function isManagerOf(tx: Transaction, auth: AuthContext, employeeId: string) {
  const [e] = await tx.select({ reportsToId: employees.reportsToId }).from(employees).where(eq(employees.id, employeeId));
  if (!e) throw new NotFoundException('Employee not found');
  if (!e.reportsToId) return false;
  const [m] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, e.reportsToId));
  return !!m?.userId && m.userId === auth.userId;
}

/**
 * Who a request is for: an explicit employee needs the manage permission (or being their
 * manager when `managerMayAct`); no employee means the signed-in user's own record.
 */
export async function subjectOf(tx: Transaction, auth: AuthContext, perms: Set<string>, managePermission: string, employeeId: string | undefined | null) {
  const self = await selfEmployee(tx, auth);
  if (!employeeId || employeeId === self?.id) {
    if (!self) throw new ForbiddenException('Your login is not linked to an employee record. Ask HR to link it.');
    if (!perms.has('hr.self.use') && !perms.has(managePermission)) throw new ForbiddenException('You do not have self-service access');
    return { employeeId: self.id, isSelf: true };
  }
  if (perms.has(managePermission) || (await isManagerOf(tx, auth, employeeId))) return { employeeId, isSelf: false };
  throw new ForbiddenException('You can only do this for yourself or your team');
}

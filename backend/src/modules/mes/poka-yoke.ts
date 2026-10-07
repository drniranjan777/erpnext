import type { Characteristic, StartCheck } from '@nextgen/database';

/**
 * Checks before a job starts at a machine (poka-yoke), kept pure: the right person, machine,
 * tool and material, the instructions read, and nothing that should stop the start.
 */

export interface StartContext {
  today: string;
  operatorName: string | null;
  /** Skills recorded for the operation's work centre (none = no qualification needed). */
  skills: { operatorName: string; level: number; validUntil: string | null }[];
  operation: { workCenterId: string; toolCode: string | null };
  machine: { code: string; workCenterId: string; requiresCleaning: boolean; cleanStatus: string; assetDown: boolean } | null;
  /** Someone else logged in at the machine. */
  otherOperator: string | null;
  tool: { code: string; status: string; lifeShots: number | null; shotsUsed: number } | null;
  scannedTool: string | null;
  /** Components the operation consumes. */
  required: { itemId: string; code: string; name: string }[];
  scanned: { code: string; batchNo: string | null; itemId: string | null; itemCode: string | null; batch: { qcStatus: string; expiryDate: string | null } | null; batchMissing: boolean }[];
  instruction: { confirmSteps: number[]; scanMaterials: boolean } | null;
  stepsAcked: number[];
  /** GMP line clearance, when the workspace requires it. */
  lineClearance?: { required: boolean; ok: boolean; detail: string | null };
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export function startChecks(c: StartContext): StartCheck[] {
  const out: StartCheck[] = [];
  const add = (code: string, label: string, ok: boolean, blocking: boolean, detail?: string) => out.push({ code, label, ok, blocking, detail: detail ?? null });

  add('operator', 'Operator named', !!c.operatorName?.trim(), true, c.operatorName?.trim() ? undefined : 'Log in at the machine or give the operator name');
  if (c.skills.length && c.operatorName) {
    const s = c.skills.find((x) => same(x.operatorName, c.operatorName));
    if (!s) add('skill', 'Operator qualified for this work centre', false, true, `${c.operatorName} has no recorded skill here`);
    else if (s.validUntil && s.validUntil < c.today) add('skill', 'Operator qualified for this work centre', false, true, `Qualification expired on ${s.validUntil}`);
    else if (s.level < 2) add('skill', 'Operator qualified for this work centre', false, true, 'Trainee: a qualified operator must run the job');
    else add('skill', 'Operator qualified for this work centre', true, true);
  }

  if (c.machine) {
    add('machine_wc', 'Machine belongs to the operation’s work centre', c.machine.workCenterId === c.operation.workCenterId, true, c.machine.workCenterId === c.operation.workCenterId ? undefined : `${c.machine.code} is on another work centre`);
    add('machine_up', 'Machine not under breakdown', !c.machine.assetDown, true, c.machine.assetDown ? `${c.machine.code} has an open breakdown` : undefined);
    if (c.machine.requiresCleaning) add('machine_clean', 'Machine cleaned', c.machine.cleanStatus === 'clean', true, c.machine.cleanStatus === 'clean' ? undefined : `${c.machine.code} is ${c.machine.cleanStatus.replace('_', ' ')}`);
    if (c.otherOperator && !same(c.otherOperator, c.operatorName)) add('session', 'Operator logged in at the machine', false, false, `${c.otherOperator} is logged in at ${c.machine.code}`);
  }

  if (c.lineClearance?.required) add('line_clearance', 'Line clearance verified', c.lineClearance.ok, true, c.lineClearance.detail ?? undefined);

  if (c.operation.toolCode) {
    if (!c.scannedTool) add('tool', `Tool ${c.operation.toolCode} scanned`, false, true, 'Scan the mould / die / fixture');
    else if (!same(c.scannedTool, c.operation.toolCode)) add('tool', `Tool ${c.operation.toolCode} scanned`, false, true, `${c.scannedTool} is not the tool for this operation`);
    else add('tool', `Tool ${c.operation.toolCode} scanned`, true, true);
  }
  if (c.tool) {
    const bad = c.tool.status === 'maintenance' || c.tool.status === 'retired';
    add('tool_status', 'Tool available', !bad, true, bad ? `${c.tool.code} is ${c.tool.status === 'maintenance' ? 'in maintenance' : 'retired'}` : undefined);
    if (c.tool.lifeShots) {
      const used = c.tool.shotsUsed / c.tool.lifeShots;
      if (used >= 1) add('tool_life', 'Tool life left', false, true, `${c.tool.code} has run ${c.tool.shotsUsed} of ${c.tool.lifeShots} shots`);
      else if (used >= 0.9) add('tool_life', 'Tool life left', false, false, `${c.tool.code} is at ${Math.round(used * 100)} % of its life`);
      else add('tool_life', 'Tool life left', true, true);
    }
  }

  if (c.instruction?.scanMaterials || c.scanned.length) {
    for (const s of c.scanned) {
      const label = `Material ${s.code}${s.batchNo ? ` batch ${s.batchNo}` : ''}`;
      if (!s.itemId) add('material', label, false, true, 'Not a known item code');
      else if (!c.required.some((r) => r.itemId === s.itemId)) add('material', label, false, true, `${s.itemCode} is not used in this operation`);
      else if (s.batchMissing) add('material', label, false, true, 'Batch not found for this item');
      else if (s.batch && !['released', 'conditional'].includes(s.batch.qcStatus)) add('material', label, false, true, `Batch is ${s.batch.qcStatus.replace('_', ' ')}`);
      else if (s.batch?.expiryDate && s.batch.expiryDate < c.today) add('material', label, false, true, `Batch expired on ${s.batch.expiryDate}`);
      else if (s.batch?.qcStatus === 'conditional') add('material', label, false, false, 'Batch released with conditions');
      else add('material', label, true, true);
    }
    if (c.instruction?.scanMaterials)
      for (const r of c.required) if (!c.scanned.some((s) => s.itemId === r.itemId)) add('material_missing', `Material ${r.code} scanned`, false, true, `Scan ${r.name} before starting`);
  }

  if (c.instruction) {
    const missing = c.instruction.confirmSteps.filter((i) => !c.stepsAcked.includes(i));
    add('instructions', 'Work instructions confirmed', !missing.length, true, missing.length ? `Confirm step${missing.length > 1 ? 's' : ''} ${missing.map((i) => i + 1).join(', ')}` : undefined);
  } else add('instructions', 'Work instructions', false, false, 'No released instructions for this operation');
  return out.map((x) => ({ ...x, detail: x.detail ?? null }));
}

export const blocked = (checks: StartCheck[]) => checks.filter((c) => !c.ok && c.blocking);

/** Readings judged against the characteristics' limits; names must match a characteristic. */
export function judge(characteristics: Characteristic[], readings: { name: string; value: number }[]) {
  return readings.map((r) => {
    const ch = characteristics.find((c) => same(c.name, r.name));
    const ok = !!ch && (ch.min == null || r.value >= ch.min) && (ch.max == null || r.value <= ch.max);
    return { name: ch?.name ?? r.name, value: r.value, ok, known: !!ch };
  });
}

/** In-line checks that are due: characteristics with a frequency whose last check is older than it. */
export function checksDue(characteristics: Characteristic[], startedAt: number, lastCheckAt: number | null, now: number) {
  return characteristics.filter((c) => c.everyMinutes && now - (lastCheckAt ?? startedAt) >= c.everyMinutes * 60_000).map((c) => c.name);
}

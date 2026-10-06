import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { customFieldDefinitions, DOC_TYPES, isDocType, type Transaction } from '@nextgen/database';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';

export type CustomFieldDef = typeof customFieldDefinitions.$inferSelect;
export type CustomValues = Record<string, string | number | boolean | null>;

/** Masters that support custom fields, alongside every registered document type. */
const MASTER_ENTITIES: Record<string, string> = { item: 'Item', party: 'Customer / Vendor' };
const isEntity = (v: string) => isDocType(v) || v in MASTER_ENTITIES;

export const customFieldSchema = z
  .object({
    entity: z.string().refine(isEntity, 'Unknown entity'),
    label: z.string().trim().min(2).max(60),
    type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional().nullable(),
    required: z.boolean().default(false),
    helpText: z.string().trim().max(200).optional().nullable(),
    showInPrint: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((f) => f.type !== 'select' || (f.options?.length ?? 0) >= 1, { message: 'Add at least one option', path: ['options'] });
export type CustomFieldInput = z.infer<typeof customFieldSchema>;

export const updateCustomFieldSchema = z.object({
  version: z.number().int(),
  label: z.string().trim().min(2).max(60).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional().nullable(),
  required: z.boolean().optional(),
  helpText: z.string().trim().max(200).optional().nullable(),
  showInPrint: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;

/** "Vendor reference no." → "vendor_reference_no" */
function toKey(label: string) {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return key && /^[a-z]/.test(key) ? key : `field_${key || Date.now().toString(36)}`;
}

/**
 * Tenant-defined fields stored in each record's `custom_fields` jsonb.
 * The type of a field never changes after creation (its key and type are fixed)
 * so stored values stay valid; fields are deactivated, not deleted.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  entities() {
    return [
      ...Object.entries(MASTER_ENTITIES).map(([value, label]) => ({ value, label })),
      ...Object.entries(DOC_TYPES).map(([value, d]) => ({ value, label: d.label })),
    ];
  }

  list(auth: AuthContext, entity?: string, activeOnly = false) {
    return this.database.run(auth, (tx) => this.definitions(tx, entity, activeOnly));
  }

  definitions(tx: Transaction, entity?: string, activeOnly = false) {
    return tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          entity ? eq(customFieldDefinitions.entity, entity) : undefined,
          activeOnly ? eq(customFieldDefinitions.isActive, true) : undefined,
        ),
      )
      .orderBy(asc(customFieldDefinitions.entity), asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label));
  }

  async create(auth: AuthContext, input: CustomFieldInput, meta: RequestMeta) {
    await this.entitlements.assertFeature(auth.tenantId, 'custom_fields');
    return this.database.run(auth, async (tx) => {
      let key = toKey(input.label);
      const existing = await this.definitions(tx, input.entity);
      if (existing.some((f) => f.label.toLowerCase() === input.label.toLowerCase())) {
        throw new ConflictException(`A field called "${input.label}" already exists`);
      }
      for (let i = 2; existing.some((f) => f.key === key); i++) key = `${toKey(input.label).slice(0, 37)}_${i}`;
      const [row] = await tx
        .insert(customFieldDefinitions)
        .values({
          ...input,
          key,
          options: input.type === 'select' ? (input.options ?? []) : null,
          helpText: input.helpText ?? null,
          tenantId: auth.tenantId,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })
        .returning();
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'platform.custom_field.created',
        entityType: 'custom_field',
        entityId: row.id,
        metadata: { entity: row.entity, key: row.key, label: row.label, type: row.type },
        ...meta,
      });
      return row;
    });
  }

  async update(auth: AuthContext, id: string, input: UpdateCustomFieldInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.id, id));
      if (!before) throw new NotFoundException('Custom field not found');
      if (before.version !== input.version) throw new ConflictException('This field was changed by someone else. Reload and try again.');
      if (before.type === 'select' && input.options && !input.options.length) throw new BadRequestException('Add at least one option');
      const { version: _v, ...patch } = input;
      const [row] = await tx
        .update(customFieldDefinitions)
        .set({ ...patch, options: before.type === 'select' ? (patch.options ?? before.options) : null, updatedBy: auth.userId, version: before.version + 1 })
        .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.version, before.version)))
        .returning();
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'platform.custom_field.updated',
        entityType: 'custom_field',
        entityId: id,
        changes: this.audit.diff(before as unknown as Record<string, unknown>, patch),
        ...meta,
      });
      return row;
    });
  }

  /**
   * Validates submitted values against the active definitions and merges them
   * over existing values (values of deactivated fields are preserved).
   */
  async validate(tx: Transaction, entity: string, input: Record<string, unknown> | undefined, existing: Record<string, unknown> = {}): Promise<CustomValues> {
    const defs = await this.definitions(tx, entity, true);
    const out: CustomValues = { ...(existing as CustomValues) };
    const errors: { path: string; message: string }[] = [];
    const values = input ?? {};

    for (const f of defs) {
      const raw = values[f.key];
      const empty = raw === undefined || raw === null || raw === '';
      if (empty) {
        if (f.required && f.type !== 'checkbox') errors.push({ path: `customFields.${f.key}`, message: `${f.label} is required` });
        out[f.key] = f.type === 'checkbox' ? false : null;
        continue;
      }
      switch (f.type) {
        case 'text':
        case 'textarea': {
          const s = String(raw).trim();
          const max = f.type === 'text' ? 500 : 5000;
          if (s.length > max) errors.push({ path: `customFields.${f.key}`, message: `${f.label}: at most ${max} characters` });
          out[f.key] = s;
          break;
        }
        case 'number': {
          const s = String(raw).trim();
          if (!/^-?\d{1,14}(\.\d{1,4})?$/.test(s)) errors.push({ path: `customFields.${f.key}`, message: `${f.label} must be a number` });
          out[f.key] = s;
          break;
        }
        case 'date': {
          const s = String(raw);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) errors.push({ path: `customFields.${f.key}`, message: `${f.label} must be a date` });
          out[f.key] = s;
          break;
        }
        case 'select': {
          const s = String(raw);
          if (!(f.options ?? []).includes(s)) errors.push({ path: `customFields.${f.key}`, message: `${f.label}: choose one of the options` });
          out[f.key] = s;
          break;
        }
        case 'checkbox':
          out[f.key] = raw === true || raw === 'true';
          break;
      }
    }
    if (errors.length) throw new BadRequestException({ message: 'Validation failed', errors });
    return out;
  }
}

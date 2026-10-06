import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GST_STATES, panFromGstin, parties, partyAddresses, partyBankAccounts, partyContacts, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { CryptoService } from '../../common/crypto.service';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, gstinSchema, ifscSchema, optionalText, panSchema, pincodeSchema, stateCodeSchema } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CustomFieldsService } from '../customization/custom-fields.service';

const addressSchema = z.object({
  id: z.uuid().optional(),
  type: z.enum(['billing', 'shipping', 'both']).default('both'),
  label: optionalText(60),
  line1: z.string().trim().min(3).max(200),
  line2: optionalText(200),
  city: z.string().trim().min(2).max(80),
  district: optionalText(80),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema.nullable().optional(),
  country: z.string().length(2).default('IN'),
  gstin: gstinSchema,
  isDefault: z.boolean().default(false),
});

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  designation: optionalText(80),
  email: z.email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 -]{8,15}$/, 'Enter a valid phone number')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  isPrimary: z.boolean().default(false),
});

const bankSchema = z.object({
  id: z.uuid().optional(),
  accountName: z.string().trim().min(2).max(120),
  /** Required for new accounts; omit to keep the stored number of an existing account. */
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'Account number: 6–20 digits')
    .optional(),
  ifsc: ifscSchema,
  bankName: optionalText(120),
  branchName: optionalText(120),
  isPrimary: z.boolean().default(false),
});

const partyBody = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Code: letters, digits, . _ / - only')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(2).max(200),
  legalName: optionalText(200),
  isCustomer: z.boolean().default(false),
  isVendor: z.boolean().default(false),
  gstRegistrationType: z.enum(['regular', 'composition', 'unregistered', 'consumer', 'overseas', 'sez']).default('regular'),
  gstin: gstinSchema,
  pan: panSchema,
  msmeUdyamNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, 'Udyam number looks like UDYAM-TS-02-0012345')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  msmeCategory: z.enum(['micro', 'small', 'medium']).nullable().optional(),
  email: z.email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: optionalText(20),
  website: optionalText(200),
  currency: z.string().length(3).toUpperCase().default('INR'),
  creditLimit: decimalSchema(2, 'Credit limit'),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
  paymentTerms: optionalText(200),
  tdsSection: optionalText(20),
  tcsApplicable: z.boolean().default(false),
  notes: optionalText(2000),
  isActive: z.boolean().default(true),
  addresses: z.array(addressSchema).max(50).default([]),
  contacts: z.array(contactSchema).max(50).default([]),
  bankAccounts: z.array(bankSchema).max(10).default([]),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createPartySchema = z.object(partyBody);
export const updatePartySchema = z.object({ ...partyBody, version: z.number().int() });
export type PartyInput = z.infer<typeof createPartySchema>;

export const listPartiesSchema = z.object({
  role: z.enum(['customer', 'vendor', 'all']).default('all'),
  q: z.string().trim().max(80).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  msme: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});

const AUDIT_FIELDS = ['code', 'name', 'isCustomer', 'isVendor', 'gstRegistrationType', 'gstin', 'pan', 'stateCode', 'msmeCategory', 'creditLimit', 'creditDays', 'tdsSection', 'isActive'] as const;

@Injectable()
export class PartiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly customFields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: z.infer<typeof listPartiesSchema>) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: parties.id,
          code: parties.code,
          name: parties.name,
          isCustomer: parties.isCustomer,
          isVendor: parties.isVendor,
          gstin: parties.gstin,
          gstRegistrationType: parties.gstRegistrationType,
          stateCode: parties.stateCode,
          msmeCategory: parties.msmeCategory,
          phone: parties.phone,
          email: parties.email,
          creditDays: parties.creditDays,
          isActive: parties.isActive,
          city: sql<string | null>`(select a.city from ${partyAddresses} a where a.party_id = ${parties.id} order by a.is_default desc limit 1)`,
        })
        .from(parties)
        .where(
          and(
            isNull(parties.deletedAt),
            q.role === 'customer' ? eq(parties.isCustomer, true) : q.role === 'vendor' ? eq(parties.isVendor, true) : undefined,
            q.active === 'all' ? undefined : eq(parties.isActive, q.active === 'true'),
            q.msme ? sql`${parties.msmeCategory} is not null` : undefined,
            term ? or(ilike(parties.name, `%${term}%`), ilike(parties.code, `${term}%`), ilike(parties.gstin, `${term}%`), ilike(parties.phone, `%${term}%`)) : undefined,
            q.cursor ? lt(parties.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(parties.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page.map((r) => ({ ...r, state: r.stateCode ? GST_STATES[r.stateCode] : null })), nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  lookup(auth: AuthContext, role: 'customer' | 'vendor', term: string) {
    return this.database.run(auth, (tx) => {
      const t = term.replace(/[%_\\]/g, '');
      return tx
        .select({ id: parties.id, code: parties.code, name: parties.name, gstin: parties.gstin, stateCode: parties.stateCode, creditDays: parties.creditDays })
        .from(parties)
        .where(
          and(
            isNull(parties.deletedAt),
            eq(parties.isActive, true),
            role === 'customer' ? eq(parties.isCustomer, true) : eq(parties.isVendor, true),
            t ? or(ilike(parties.name, `%${t}%`), ilike(parties.code, `${t}%`), ilike(parties.gstin, `${t}%`)) : undefined,
          ),
        )
        .orderBy(asc(parties.name))
        .limit(20);
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.load(tx, id));
  }

  create(auth: AuthContext, input: PartyInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  /** Same as create(), inside the caller's transaction (used by imports). */
  async createTx(tx: Transaction, auth: AuthContext, input: PartyInput, meta: RequestMeta) {
    const values = this.validate(input);
    const code = input.code ?? (await nextCode(tx, auth.tenantId, input.isCustomer ? 'customer' : 'vendor', input.isCustomer ? 'CUS' : 'VEN'));
    await this.assertUnique(tx, code, values.gstin);
    const customFields = await this.customFields.validate(tx, 'party', input.customFields);
    const [row] = await tx
      .insert(parties)
      .values({ ...values, code, customFields, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId })
      .returning({ id: parties.id });
    await this.writeChildren(tx, auth.tenantId, row.id, input, []);
    await this.audit.log(tx, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'masters.party.created',
      entityType: 'party',
      entityId: row.id,
      metadata: { code, name: input.name, gstin: values.gstin, customer: input.isCustomer, vendor: input.isVendor },
      ...meta,
    });
    return this.load(tx, row.id);
  }

  update(auth: AuthContext, id: string, input: PartyInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(parties).where(and(eq(parties.id, id), isNull(parties.deletedAt))).for('update');
      if (!before) throw new NotFoundException('Customer / vendor not found');
      if (before.version !== input.version) throw new ConflictException('This record was changed by someone else. Reload to see the latest version.');
      const values = this.validate(input);
      const code = input.code ?? before.code;
      await this.assertUnique(tx, code, values.gstin, id);
      const customFields = await this.customFields.validate(tx, 'party', input.customFields, before.customFields);
      await tx.update(parties).set({ ...values, code, customFields, updatedBy: auth.userId, version: before.version + 1 }).where(eq(parties.id, id));
      const existingBanks = await tx.select().from(partyBankAccounts).where(eq(partyBankAccounts.partyId, id));
      await tx.delete(partyAddresses).where(eq(partyAddresses.partyId, id));
      await tx.delete(partyContacts).where(eq(partyContacts.partyId, id));
      await tx.delete(partyBankAccounts).where(eq(partyBankAccounts.partyId, id));
      await this.writeChildren(tx, auth.tenantId, id, input, existingBanks);
      const after = { ...values, code } as Record<string, unknown>;
      const changes = this.audit.diff(
        Object.fromEntries(AUDIT_FIELDS.map((f) => [f, (before as Record<string, unknown>)[f]])),
        Object.fromEntries(AUDIT_FIELDS.map((f) => [f, after[f] ?? null])),
      );
      const bankChanged = JSON.stringify(existingBanks.map((b) => [b.accountLast4, b.ifsc]).sort()) !== JSON.stringify(input.bankAccounts.map((b) => [b.accountNumber?.slice(-4) ?? existingBanks.find((e) => e.id === b.id)?.accountLast4, b.ifsc]).sort());
      if (bankChanged) changes.bankAccounts = { from: existingBanks.map((b) => `${b.ifsc} ••${b.accountLast4}`), to: input.bankAccounts.map((b) => `${b.ifsc} ••${b.accountNumber?.slice(-4) ?? existingBanks.find((e) => e.id === b.id)?.accountLast4}`) };
      if (Object.keys(changes).length) {
        await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'masters.party.updated', entityType: 'party', entityId: id, changes, ...meta });
      }
      return this.load(tx, id);
    });
  }

  // ---- helpers ------------------------------------------------------------------

  private validate(input: PartyInput) {
    const errors: { path: string; message: string }[] = [];
    if (!input.isCustomer && !input.isVendor) errors.push({ path: 'isCustomer', message: 'Mark as a customer, a vendor, or both' });
    const needsGstin = ['regular', 'composition', 'sez'].includes(input.gstRegistrationType);
    if (needsGstin && !input.gstin) errors.push({ path: 'gstin', message: 'GSTIN is required for registered businesses' });
    if (!needsGstin && input.gstin) errors.push({ path: 'gstin', message: `Remove the GSTIN or change the registration type (${input.gstRegistrationType})` });
    if (input.gstin && input.pan && panFromGstin(input.gstin) !== input.pan) errors.push({ path: 'pan', message: 'PAN does not match the GSTIN' });
    if (input.msmeCategory && !input.msmeUdyamNo) errors.push({ path: 'msmeUdyamNo', message: 'Enter the Udyam registration number' });
    if (input.gstRegistrationType === 'overseas' && input.addresses.some((a) => a.country === 'IN' && a.stateCode !== '96')) {
      errors.push({ path: 'addresses', message: 'Overseas parties need a foreign address (state code 96)' });
    }
    input.addresses.forEach((a, i) => {
      if (!(a.stateCode in GST_STATES)) errors.push({ path: `addresses.${i}.stateCode`, message: 'Choose a valid state' });
      if (a.gstin && a.gstin.slice(0, 2) !== a.stateCode) errors.push({ path: `addresses.${i}.gstin`, message: 'GSTIN state code does not match the address state' });
      if (a.country === 'IN' && !a.pincode) errors.push({ path: `addresses.${i}.pincode`, message: 'PIN code is required for Indian addresses' });
    });
    if (errors.length) throw new BadRequestException({ message: 'Validation failed', errors });

    const billing = input.addresses.find((a) => a.isDefault && a.type !== 'shipping') ?? input.addresses.find((a) => a.type !== 'shipping');
    const { code: _c, addresses: _a, contacts: _ct, bankAccounts: _b, customFields: _cf, ...fields } = input as PartyInput & { version?: number };
    delete (fields as { version?: number }).version;
    return {
      ...fields,
      gstin: input.gstin ?? null,
      pan: input.pan ?? (input.gstin ? panFromGstin(input.gstin) : null),
      // Place of supply: GSTIN state, else billing address state.
      stateCode: input.gstin ? input.gstin.slice(0, 2) : (billing?.stateCode ?? null),
      msmeCategory: input.msmeCategory ?? null,
      creditDays: input.creditDays ?? null,
    };
  }

  private async writeChildren(tx: Transaction, tenantId: string, partyId: string, input: PartyInput, existingBanks: (typeof partyBankAccounts.$inferSelect)[]) {
    if (input.addresses.length) {
      const hasDefault = input.addresses.some((a) => a.isDefault);
      await tx.insert(partyAddresses).values(
        input.addresses.map((a, i) => ({
          tenantId,
          partyId,
          type: a.type,
          label: a.label,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          district: a.district,
          stateCode: a.stateCode,
          pincode: a.pincode ?? null,
          country: a.country,
          gstin: a.gstin,
          isDefault: hasDefault ? a.isDefault : i === 0,
        })),
      );
    }
    if (input.contacts.length) {
      const hasPrimary = input.contacts.some((c) => c.isPrimary);
      await tx.insert(partyContacts).values(input.contacts.map((c, i) => ({ tenantId, partyId, ...c, email: c.email ?? null, phone: c.phone ?? null, isPrimary: hasPrimary ? c.isPrimary : i === 0 })));
    }
    if (input.bankAccounts.length) {
      const hasPrimary = input.bankAccounts.some((b) => b.isPrimary);
      const rows = input.bankAccounts.map((b, i) => {
        const prior = b.id ? existingBanks.find((e) => e.id === b.id) : undefined;
        if (!b.accountNumber && !prior) {
          throw new BadRequestException({ message: 'Validation failed', errors: [{ path: `bankAccounts.${i}.accountNumber`, message: 'Account number is required' }] });
        }
        return {
          tenantId,
          partyId,
          accountName: b.accountName,
          accountNumberEncrypted: b.accountNumber ? this.crypto.encrypt(b.accountNumber) : prior!.accountNumberEncrypted,
          accountLast4: b.accountNumber ? b.accountNumber.slice(-4) : prior!.accountLast4,
          ifsc: b.ifsc,
          bankName: b.bankName,
          branchName: b.branchName,
          isPrimary: hasPrimary ? b.isPrimary : i === 0,
        };
      });
      await tx.insert(partyBankAccounts).values(rows);
    }
  }

  private async assertUnique(tx: Transaction, code: string, gstin: string | null, exceptId?: string) {
    const clash = await tx
      .select({ code: parties.code, name: parties.name, gstin: parties.gstin })
      .from(parties)
      .where(
        and(
          isNull(parties.deletedAt),
          or(sql`${parties.code} = ${code}`, gstin ? eq(parties.gstin, gstin) : sql`false`),
          exceptId ? ne(parties.id, exceptId) : undefined,
        ),
      );
    const byCode = clash.find((c) => c.code.toUpperCase() === code.toUpperCase());
    if (byCode) throw new ConflictException(`Code ${code} is already used by ${byCode.name}`);
    if (clash.length) throw new ConflictException(`GSTIN ${gstin} already belongs to ${clash[0].name} (${clash[0].code}). Mark that record as both customer and vendor instead of duplicating it.`);
  }

  private async load(tx: Transaction, id: string) {
    const [p] = await tx.select().from(parties).where(and(eq(parties.id, id), isNull(parties.deletedAt)));
    if (!p) throw new NotFoundException('Customer / vendor not found');
    const addresses = await tx.select().from(partyAddresses).where(eq(partyAddresses.partyId, id)).orderBy(desc(partyAddresses.isDefault), asc(partyAddresses.label));
    const contacts = await tx.select().from(partyContacts).where(eq(partyContacts.partyId, id)).orderBy(desc(partyContacts.isPrimary), asc(partyContacts.name));
    const banks = await tx.select().from(partyBankAccounts).where(eq(partyBankAccounts.partyId, id)).orderBy(desc(partyBankAccounts.isPrimary));
    const { tenantId: _t, ...rest } = p;
    return {
      ...rest,
      state: p.stateCode ? GST_STATES[p.stateCode] : null,
      addresses: addresses.map(({ tenantId: _a, partyId: _p, ...a }) => ({ ...a, state: GST_STATES[a.stateCode] ?? null })),
      contacts: contacts.map(({ tenantId: _a, partyId: _p, ...c }) => c),
      // Account numbers are never returned in full.
      bankAccounts: banks.map((b) => ({
        id: b.id,
        accountName: b.accountName,
        accountNumberMasked: `•••• ${b.accountLast4}`,
        ifsc: b.ifsc,
        bankName: b.bankName,
        branchName: b.branchName,
        isPrimary: b.isPrimary,
      })),
    };
  }
}

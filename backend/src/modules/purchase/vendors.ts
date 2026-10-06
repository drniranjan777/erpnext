import { BadRequestException } from '@nestjs/common';
import { parties, partyAddresses, type Transaction } from '@nextgen/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { RegistrationType } from '../gst/gst-engine';

export type VendorSnapshot = Awaited<ReturnType<typeof loadVendor>>;

/** A vendor with what purchase documents snapshot: GSTIN, state, registration, billing address, MSME, TDS. */
export async function loadVendor(tx: Transaction, vendorId: string, path = 'vendorId') {
  const fail = (message: string): never => {
    throw new BadRequestException({ message, errors: [{ path, message }] });
  };
  const [v] = await tx.select().from(parties).where(and(eq(parties.id, vendorId), isNull(parties.deletedAt)));
  if (!v) return fail('Vendor not found');
  if (!v.isVendor) fail(`${v.name} is not set up as a vendor`);
  if (!v.isActive) fail(`${v.name} is inactive`);
  const addresses = await tx.select().from(partyAddresses).where(eq(partyAddresses.partyId, v.id));
  const billing = addresses.find((a) => a.isDefault && a.type !== 'shipping') ?? addresses.find((a) => a.type !== 'shipping') ?? addresses[0];
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    email: v.email,
    gstin: v.gstin,
    pan: v.pan,
    registration: v.gstRegistrationType as RegistrationType,
    stateCode: v.stateCode ?? (v.gstin ? v.gstin.slice(0, 2) : null) ?? billing?.stateCode ?? null,
    creditDays: v.creditDays,
    paymentTerms: v.paymentTerms,
    msmeCategory: v.msmeCategory,
    tdsSection: v.tdsSection,
    address: billing ? { line1: billing.line1, line2: billing.line2 ?? undefined, city: billing.city, stateCode: billing.stateCode, pincode: billing.pincode ?? undefined } : {},
  };
}

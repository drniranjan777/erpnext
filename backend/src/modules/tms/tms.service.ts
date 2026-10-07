import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deliveryNotes, parties, tmsFreightBills, tmsPositions, tmsRateContracts, tmsRates, tmsStops, tmsTransporters, tmsTrips, tmsVehicles, type Transaction } from '@nextgen/database';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { freight, matchRate, trailKm, type Rate } from './freight';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reg = (v: string) => v.toUpperCase().replace(/[\s-]/g, '');

export const transporterSchema = z.object({ partyId: z.uuid(), transporterGstId: z.string().trim().regex(/^[0-9A-Z]{15}$/, '15 characters (GSTIN or TRANSIN)').nullable().optional(), isActive: z.boolean().default(true) });
export const vehicleSchema = z.object({
  regNo: z.string().trim().min(6).max(15),
  ownership: z.enum(['own', 'hired']).default('hired'),
  vehicleType: z.string().trim().min(2).max(30),
  capacityKg: z.number().positive().max(100_000).nullable().optional(),
  capacityM3: z.number().positive().max(500).nullable().optional(),
  transporterId: z.uuid().nullable().optional(),
  driverName: text(80),
  driverPhone: text(20),
  isActive: z.boolean().default(true),
});
const rateLine = z.object({
  fromCity: text(60),
  fromState: z.string().regex(/^\d{2}$/).nullable().optional(),
  toCity: text(60),
  toState: z.string().regex(/^\d{2}$/).nullable().optional(),
  vehicleType: text(30),
  basis: z.enum(['per_kg', 'per_trip', 'per_km']),
  rate: z.number().positive().max(1e7),
  minCharge: z.number().min(0).max(1e7).nullable().optional(),
  perStop: z.number().min(0).max(1e6).nullable().optional(),
});
export const contractSchema = z.object({ transporterId: z.uuid(), validFrom: z.iso.date(), validTo: z.iso.date(), notes: text(500), rates: z.array(rateLine).min(1).max(500) });
export const tripSchema = z.object({
  tripDate: z.iso.date().optional(),
  warehouseId: z.uuid().nullable().optional(),
  vehicleId: z.uuid().nullable().optional(),
  vehicleNo: z.string().trim().min(6).max(15).optional(),
  vehicleType: text(30),
  transporterId: z.uuid().nullable().optional(),
  driverName: text(80),
  driverPhone: text(20),
  plannedKm: z.number().int().positive().max(10_000).nullable().optional(),
  deliveryIds: z.array(z.uuid()).min(1).max(50),
});
export const dispatchSchema = z.object({ odometerStart: z.number().int().min(0).max(10_000_000).nullable().optional() });
export const completeSchema = z.object({ odometerEnd: z.number().int().min(0).max(10_000_000).nullable().optional() });
export const expenseSchema = z.object({ kind: z.enum(['toll', 'fuel', 'loading', 'unloading', 'parking', 'other']), amount: z.number().positive().max(1e6), note: text(200) });
export const positionSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), speedKmh: z.number().min(0).max(300).nullable().optional(), at: z.iso.datetime({ offset: true }).optional(), source: z.enum(['driver', 'gps', 'fastag']).default('driver') });
export const podSchema = z.object({ receivedBy: z.string().trim().min(2).max(80), signature: z.string().startsWith('data:image/').max(300_000).nullable().optional(), photo: z.string().startsWith('data:image/').max(1_500_000).nullable().optional(), note: text(500), latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional() });
export const failSchema = z.object({ note: z.string().trim().min(3).max(500) });
export const billSchema = z.object({ transporterId: z.uuid(), billNo: z.string().trim().min(1).max(40), billDate: z.iso.date(), lines: z.array(z.object({ tripId: z.uuid(), claimed: z.number().min(0).max(1e8) })).min(1).max(500) });
export const decideBillSchema = z.object({ approve: z.boolean(), note: text(500) });

/**
 * Transport: transporters, vehicles and rate contracts; trip sheets of delivery notes with freight
 * from the contract; the driver's link for positions and proof of delivery; freight bill checking.
 */
@Injectable()
export class TmsService {
  private readonly appUrl: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // ---- masters ---------------------------------------------------------------------------------

  transporters(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select t.id, t.party_id as "partyId", p.name, p.gstin, t.transporter_gst_id as "transporterGstId", t.is_active as "isActive", (select count(*)::int from tms_vehicles v where v.transporter_id = t.id) as vehicles from tms_transporters t join parties p on p.id = t.party_id order by p.name`),
    );
  }

  saveTransporter(auth: AuthContext, id: string | null, input: z.infer<typeof transporterSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ isVendor: parties.isVendor, gstin: parties.gstin }).from(parties).where(eq(parties.id, input.partyId));
      if (!p?.isVendor) throw new BadRequestException('A transporter must be a vendor');
      const values = { partyId: input.partyId, transporterGstId: input.transporterGstId ?? p.gstin ?? null, isActive: input.isActive };
      if (id) return (await tx.update(tmsTransporters).set(values).where(eq(tmsTransporters.id, id)).returning())[0];
      const [dup] = await tx.select({ id: tmsTransporters.id }).from(tmsTransporters).where(eq(tmsTransporters.partyId, input.partyId));
      if (dup) throw new ConflictException('Already a transporter');
      return (await tx.insert(tmsTransporters).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  vehicles(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select v.id, v.reg_no as "regNo", v.ownership, v.vehicle_type as "vehicleType", v.capacity_kg as "capacityKg", v.capacity_m3 as "capacityM3", v.transporter_id as "transporterId", p.name as transporter, v.driver_name as "driverName", v.driver_phone as "driverPhone", v.is_active as "isActive" from tms_vehicles v left join tms_transporters t on t.id = v.transporter_id left join parties p on p.id = t.party_id order by v.reg_no`),
    );
  }

  saveVehicle(auth: AuthContext, id: string | null, input: z.infer<typeof vehicleSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, regNo: reg(input.regNo), capacityKg: input.capacityKg?.toString() ?? null, capacityM3: input.capacityM3?.toString() ?? null, transporterId: input.transporterId ?? null, driverName: input.driverName ?? null, driverPhone: input.driverPhone ?? null };
      if (id) return (await tx.update(tmsVehicles).set(values).where(eq(tmsVehicles.id, id)).returning())[0];
      const [dup] = await tx.select({ id: tmsVehicles.id }).from(tmsVehicles).where(eq(tmsVehicles.regNo, values.regNo));
      if (dup) throw new ConflictException(`${values.regNo} is already registered`);
      return (await tx.insert(tmsVehicles).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  contracts(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select c.id, c.number, c.transporter_id as "transporterId", p.name as transporter, c.valid_from as "validFrom", c.valid_to as "validTo", c.is_active as "isActive", c.notes, (select count(*)::int from tms_rates r where r.contract_id = c.id) as rates from tms_rate_contracts c join tms_transporters t on t.id = c.transporter_id join parties p on p.id = t.party_id order by c.valid_to desc`),
    );
  }

  contract(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(tmsRateContracts).where(eq(tmsRateContracts.id, id));
      if (!c) throw new NotFoundException('Contract not found');
      return { ...c, rates: await tx.select().from(tmsRates).where(eq(tmsRates.contractId, id)) };
    });
  }

  createContract(auth: AuthContext, input: z.infer<typeof contractSchema>) {
    return this.database.run(auth, async (tx) => {
      if (input.validTo < input.validFrom) throw new BadRequestException('The contract ends before it starts');
      const [t] = await tx.select().from(tmsTransporters).where(eq(tmsTransporters.id, input.transporterId));
      if (!t) throw new NotFoundException('Transporter not found');
      const number = await nextCode(tx, auth.tenantId, 'tms_contract', 'FRC', 4);
      const [c] = await tx.insert(tmsRateContracts).values({ tenantId: auth.tenantId, number, transporterId: input.transporterId, validFrom: input.validFrom, validTo: input.validTo, notes: input.notes ?? null }).returning();
      await tx.insert(tmsRates).values(
        input.rates.map((r) => ({
          tenantId: auth.tenantId,
          contractId: c.id,
          fromCity: r.fromCity || null,
          fromState: r.fromState || null,
          toCity: r.toCity || null,
          toState: r.toState || null,
          vehicleType: r.vehicleType || null,
          basis: r.basis,
          rate: r.rate.toFixed(2),
          minCharge: r.minCharge ? r.minCharge.toFixed(2) : null,
          perStop: r.perStop ? r.perStop.toFixed(2) : null,
        })),
      );
      return c;
    });
  }

  // ---- trips -------------------------------------------------------------------------------------

  /** Posted delivery notes not yet on a live trip (to plan trips from). */
  unplanned(auth: AuthContext, warehouseId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select dn.id, d.number, d.doc_date::text as "docDate", p.name as customer, dn.shipping_address->>'city' as city, dn.shipping_address->>'stateCode' as "stateCode", dn.gross_weight_kg as "grossWeightKg", dn.packages, w.code as warehouse
            from delivery_notes dn join documents d on d.id = dn.id join parties p on p.id = dn.customer_id left join warehouses w on w.id = dn.warehouse_id
            where d.status = 'approved' and dn.delivered_at is null ${warehouseId ? sql`and dn.warehouse_id = ${warehouseId}` : sql``}
              and not exists (select 1 from tms_stops s join tms_trips t on t.id = s.trip_id where s.delivery_id = dn.id and t.status <> 'cancelled')
            order by d.doc_date, d.number limit 300`,
      ),
    );
  }

  private async rateFor(tx: Transaction, transporterId: string | null, date: string, lane: Parameters<typeof matchRate>[1]) {
    if (!transporterId) return null;
    const rows = await many<{ id: string; fromCity: string | null; fromState: string | null; toCity: string | null; toState: string | null; vehicleType: string | null; basis: Rate['basis']; rate: string; minCharge: string | null; perStop: string | null }>(
      tx,
      sql`select r.id, r.from_city as "fromCity", r.from_state as "fromState", r.to_city as "toCity", r.to_state as "toState", r.vehicle_type as "vehicleType", r.basis, r.rate::text as rate, r.min_charge::text as "minCharge", r.per_stop::text as "perStop"
          from tms_rates r join tms_rate_contracts c on c.id = r.contract_id where c.transporter_id = ${transporterId} and c.is_active and ${date} between c.valid_from and c.valid_to`,
    );
    return matchRate(rows.map((r) => ({ ...r, rate: Number(r.rate), minCharge: r.minCharge ? Number(r.minCharge) : null, perStop: r.perStop ? Number(r.perStop) : null })), lane);
  }

  createTrip(auth: AuthContext, input: z.infer<typeof tripSchema>) {
    return this.database.run(auth, async (tx) => {
      const date = input.tripDate ?? todayIST();
      const [v] = input.vehicleId ? await tx.select().from(tmsVehicles).where(eq(tmsVehicles.id, input.vehicleId)) : [];
      if (input.vehicleId && !v) throw new NotFoundException('Vehicle not found');
      const vehicleNo = v?.regNo ?? (input.vehicleNo ? reg(input.vehicleNo) : null);
      if (!vehicleNo) throw new BadRequestException('Choose a vehicle or give its number');
      const transporterId = input.transporterId ?? v?.transporterId ?? null;
      const vehicleType = input.vehicleType ?? v?.vehicleType ?? null;
      const dns = await many<{ id: string; number: string; status: string; customerId: string; addr: { line1?: string; city?: string; stateCode?: string; pincode?: string }; grossWeightKg: string | null; warehouseId: string | null; deliveredAt: string | null }>(
        tx,
        sql`select dn.id, d.number, d.status, dn.customer_id as "customerId", dn.shipping_address as addr, dn.gross_weight_kg::text as "grossWeightKg", dn.warehouse_id as "warehouseId", dn.delivered_at as "deliveredAt"
            from delivery_notes dn join documents d on d.id = dn.id where dn.id in ${input.deliveryIds}`,
      );
      for (const id of input.deliveryIds) {
        const d = dns.find((x) => x.id === id);
        if (!d) throw new NotFoundException('Delivery note not found');
        if (d.status !== 'approved') throw new BadRequestException(`Delivery ${d.number ?? ''} is not posted`);
        if (d.deliveredAt) throw new BadRequestException(`Delivery ${d.number} is already delivered`);
      }
      const [busy] = await many<{ number: string; trip: string }>(tx, sql`select d.number, t.number as trip from tms_stops s join tms_trips t on t.id = s.trip_id join documents d on d.id = s.delivery_id where s.delivery_id in ${input.deliveryIds} and t.status <> 'cancelled' limit 1`);
      if (busy) throw new ConflictException(`Delivery ${busy.number} is already on trip ${busy.trip}`);
      const weight = dns.reduce((s, d) => s + Number(d.grossWeightKg ?? 0), 0);
      if (v?.capacityKg && weight > Number(v.capacityKg)) throw new BadRequestException(`${weight} kg is more than ${v.regNo} carries (${Number(v.capacityKg)} kg)`);
      const warehouseId = input.warehouseId ?? dns[0].warehouseId;
      const [wh] = warehouseId ? await many<{ city: string | null; stateCode: string | null }>(tx, sql`select address->>'city' as city, address->>'stateCode' as "stateCode" from warehouses where id = ${warehouseId}`) : [];
      const ordered = input.deliveryIds.map((id) => dns.find((d) => d.id === id)!);
      const last = ordered[ordered.length - 1].addr ?? {};
      const rate = await this.rateFor(tx, transporterId, date, { fromCity: wh?.city ?? null, fromState: wh?.stateCode ?? null, toCity: last.city ?? null, toState: last.stateCode ?? null, vehicleType });
      let f: { amount: number; basis: string } | null = null;
      if (rate) {
        try {
          f = freight(rate, { weightKg: weight, km: input.plannedKm ?? null, stops: ordered.length });
        } catch (e) {
          throw new BadRequestException((e as Error).message);
        }
      }
      const number = await nextCode(tx, auth.tenantId, 'tms_trip', 'TR', 6);
      const [trip] = await tx
        .insert(tmsTrips)
        .values({
          tenantId: auth.tenantId,
          number,
          tripDate: date,
          warehouseId: warehouseId ?? null,
          transporterId,
          vehicleId: v?.id ?? null,
          vehicleNo,
          vehicleType,
          driverName: input.driverName ?? v?.driverName ?? null,
          driverPhone: input.driverPhone ?? v?.driverPhone ?? null,
          plannedKm: input.plannedKm ?? null,
          weightKg: weight.toFixed(3),
          rateId: rate?.id ?? null,
          freightAmount: f ? f.amount.toFixed(2) : null,
          freightBasis: f?.basis ?? (transporterId ? 'no contract rate for this lane' : null),
          createdBy: auth.userId,
        })
        .returning();
      await tx.insert(tmsStops).values(ordered.map((d, i) => ({ tenantId: auth.tenantId, tripId: trip.id, seq: i + 1, deliveryId: d.id, partyId: d.customerId, city: d.addr?.city ?? null, stateCode: d.addr?.stateCode ?? null, address: [d.addr?.line1, d.addr?.city, d.addr?.pincode].filter(Boolean).join(', ') || null })));
      await tx.update(deliveryNotes).set({ vehicleNo }).where(and(inArray(deliveryNotes.id, input.deliveryIds), sql`${deliveryNotes.vehicleNo} is null`));
      return trip;
    });
  }

  trips(auth: AuthContext, q: { from?: string; to?: string; status?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.number, t.trip_date as "tripDate", t.status, t.vehicle_no as "vehicleNo", t.vehicle_type as "vehicleType", t.driver_name as "driverName", p.name as transporter, t.weight_kg as "weightKg", t.freight_amount as "freightAmount",
                   (select count(*)::int from tms_stops s where s.trip_id = t.id) as stops, (select count(*)::int from tms_stops s where s.trip_id = t.id and s.status = 'delivered') as delivered,
                   (select max(at) from tms_positions x where x.trip_id = t.id) as "lastSeen"
            from tms_trips t left join tms_transporters tr on tr.id = t.transporter_id left join parties p on p.id = tr.party_id
            where true ${q.from ? sql`and t.trip_date >= ${q.from}` : sql``} ${q.to ? sql`and t.trip_date <= ${q.to}` : sql``} ${q.status ? sql`and t.status = ${q.status}` : sql``}
            order by t.trip_date desc, t.number desc limit 300`,
      ),
    );
  }

  private async view(tx: Transaction, id: string, forDriver: boolean) {
    const [t] = await many<{ id: string; odometerStart: number | null; odometerEnd: number | null; expenses: { amount: string }[] }>(
      tx,
      sql`select t.id, t.number, t.trip_date as "tripDate", t.status, t.vehicle_no as "vehicleNo", t.vehicle_type as "vehicleType", t.driver_name as "driverName", t.driver_phone as "driverPhone", p.name as transporter, t.transporter_id as "transporterId",
                 t.planned_km as "plannedKm", t.odometer_start as "odometerStart", t.odometer_end as "odometerEnd", t.weight_kg as "weightKg", t.freight_amount as "freightAmount", t.freight_basis as "freightBasis", t.expenses,
                 t.dispatched_at as "dispatchedAt", t.completed_at as "completedAt", w.code as warehouse, fb.number as "freightBill"
          from tms_trips t left join tms_transporters tr on tr.id = t.transporter_id left join parties p on p.id = tr.party_id left join warehouses w on w.id = t.warehouse_id left join tms_freight_bills fb on fb.id = t.freight_bill_id
          where t.id = ${id}`,
    );
    if (!t) throw new NotFoundException('Trip not found');
    const stops = await many(
      tx,
      sql`select s.id, s.seq, s.status, s.city, s.address, s.delivery_id as "deliveryId", d.number as "deliveryNumber", p.name as customer, p.phone, dn.packages, dn.gross_weight_kg as "grossWeightKg",
                 s.arrived_at as "arrivedAt", s.delivered_at as "deliveredAt", s.received_by as "receivedBy", s.note ${forDriver ? sql`` : sql`, s.signature, s.photo, s.latitude, s.longitude`}
          from tms_stops s left join documents d on d.id = s.delivery_id left join delivery_notes dn on dn.id = s.delivery_id left join parties p on p.id = s.party_id where s.trip_id = ${id} order by s.seq`,
    );
    const trail = await many<{ lat: number; lng: number; at: string; speedKmh: string | null; source: string }>(tx, sql`select latitude as lat, longitude as lng, at, speed_kmh as "speedKmh", source from tms_positions where trip_id = ${id} order by at`);
    const base = { ...t, stops, lastPosition: trail[trail.length - 1] ?? null, trackedKm: trailKm(trail) };
    if (forDriver) {
      const { freightAmount: _f, freightBasis: _b, transporterId: _t, ...rest } = base as Record<string, unknown>;
      return rest;
    }
    return { ...base, odometerKm: t.odometerStart !== null && t.odometerEnd !== null ? t.odometerEnd - t.odometerStart : null, expensesTotal: t.expenses.reduce((s, e) => s + Number(e.amount), 0).toFixed(2), trail: trail.slice(-200) };
  }

  trip(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, id, false));
  }

  /** Marks the trip on the road and issues the driver's link (for positions and proof of delivery). */
  dispatch(auth: AuthContext, id: string, input: z.infer<typeof dispatchSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(tmsTrips).where(eq(tmsTrips.id, id)).for('update');
      if (!t) throw new NotFoundException('Trip not found');
      if (t.status !== 'planned') throw new ConflictException(`The trip is ${t.status}`);
      const token = `${auth.tenantId}.${randomBytes(24).toString('base64url')}`;
      await tx.update(tmsTrips).set({ status: 'dispatched', dispatchedAt: new Date(), odometerStart: input.odometerStart ?? null, driverTokenHash: sha256(token) }).where(eq(tmsTrips.id, id));
      return { ok: true, driverUrl: `${this.appUrl}/driver?t=${encodeURIComponent(token)}`, token };
    });
  }

  /** A fresh driver link (the old one stops working). */
  relink(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(tmsTrips).where(eq(tmsTrips.id, id)).for('update');
      if (!t || t.status !== 'dispatched') throw new ConflictException('Only a trip on the road has a driver link');
      const token = `${auth.tenantId}.${randomBytes(24).toString('base64url')}`;
      await tx.update(tmsTrips).set({ driverTokenHash: sha256(token) }).where(eq(tmsTrips.id, id));
      return { driverUrl: `${this.appUrl}/driver?t=${encodeURIComponent(token)}`, token };
    });
  }

  addExpense(auth: AuthContext, id: string, input: z.infer<typeof expenseSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(tmsTrips).where(eq(tmsTrips.id, id)).for('update');
      if (!t) throw new NotFoundException('Trip not found');
      if (t.freightBillId) throw new ConflictException('The trip is already billed');
      const expenses = [...t.expenses, { kind: input.kind, amount: input.amount.toFixed(2), note: input.note ?? null }];
      await tx.update(tmsTrips).set({ expenses }).where(eq(tmsTrips.id, id));
      return { expenses };
    });
  }

  complete(auth: AuthContext, id: string, input: z.infer<typeof completeSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(tmsTrips).where(eq(tmsTrips.id, id)).for('update');
      if (!t) throw new NotFoundException('Trip not found');
      if (t.status !== 'dispatched') throw new ConflictException(`The trip is ${t.status}`);
      const [open] = await many(tx, sql`select 1 from tms_stops where trip_id = ${id} and status in ('pending', 'arrived') limit 1`);
      if (open) throw new ConflictException('Record delivery (or failure) for every stop first');
      if (input.odometerEnd != null && t.odometerStart != null && input.odometerEnd < t.odometerStart) throw new BadRequestException('The closing reading is below the opening one');
      await tx.update(tmsTrips).set({ status: 'completed', completedAt: new Date(), odometerEnd: input.odometerEnd ?? null, driverTokenHash: null }).where(eq(tmsTrips.id, id));
      return { ok: true };
    });
  }

  cancel(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.update(tmsTrips).set({ status: 'cancelled', driverTokenHash: null }).where(and(eq(tmsTrips.id, id), eq(tmsTrips.status, 'planned'))).returning({ id: tmsTrips.id });
      if (!t) throw new ConflictException('Only a planned trip can be cancelled');
      return { ok: true };
    });
  }

  // ---- stops (staff and driver) ---------------------------------------------------------------

  private async stopFor(tx: Transaction, tripId: string, stopId: string) {
    const [t] = await tx.select().from(tmsTrips).where(eq(tmsTrips.id, tripId));
    if (!t) throw new NotFoundException('Trip not found');
    if (t.status !== 'dispatched') throw new ConflictException(t.status === 'planned' ? 'Dispatch the trip first' : `The trip is ${t.status}`);
    const [s] = await tx.select().from(tmsStops).where(and(eq(tmsStops.id, stopId), eq(tmsStops.tripId, tripId))).for('update');
    if (!s) throw new NotFoundException('Stop not found');
    return { t, s };
  }

  private async arriveTx(tx: Transaction, tripId: string, stopId: string) {
    const { s } = await this.stopFor(tx, tripId, stopId);
    if (s.status !== 'pending') throw new ConflictException(`The stop is ${s.status}`);
    await tx.update(tmsStops).set({ status: 'arrived', arrivedAt: new Date() }).where(eq(tmsStops.id, stopId));
    return { ok: true };
  }

  private async podTx(tx: Transaction, tripId: string, stopId: string, input: z.infer<typeof podSchema>) {
    const { s } = await this.stopFor(tx, tripId, stopId);
    if (!['pending', 'arrived'].includes(s.status)) throw new ConflictException(`The stop is already ${s.status}`);
    const now = new Date();
    await tx
      .update(tmsStops)
      .set({ status: 'delivered', arrivedAt: s.arrivedAt ?? now, deliveredAt: now, receivedBy: input.receivedBy, signature: input.signature ?? null, photo: input.photo ?? null, note: input.note ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null })
      .where(eq(tmsStops.id, stopId));
    // The delivery note's proof of delivery.
    if (s.deliveryId) await tx.update(deliveryNotes).set({ deliveredAt: now, podNote: `Received by ${input.receivedBy}${input.note ? `: ${input.note}` : ''}` }).where(eq(deliveryNotes.id, s.deliveryId));
    return { ok: true };
  }

  private async failTx(tx: Transaction, tripId: string, stopId: string, input: z.infer<typeof failSchema>) {
    const { s } = await this.stopFor(tx, tripId, stopId);
    if (!['pending', 'arrived'].includes(s.status)) throw new ConflictException(`The stop is already ${s.status}`);
    await tx.update(tmsStops).set({ status: 'failed', note: input.note }).where(eq(tmsStops.id, stopId));
    return { ok: true };
  }

  private async positionTx(tx: Transaction, tenantId: string, tripId: string, input: z.infer<typeof positionSchema>) {
    const [t] = await tx.select({ status: tmsTrips.status }).from(tmsTrips).where(eq(tmsTrips.id, tripId));
    if (!t) throw new NotFoundException('Trip not found');
    if (t.status !== 'dispatched') throw new ConflictException('The trip is not on the road');
    await tx.insert(tmsPositions).values({ tenantId, tripId, latitude: input.latitude, longitude: input.longitude, speedKmh: input.speedKmh?.toString() ?? null, at: input.at ? new Date(input.at) : new Date(), source: input.source });
    return { ok: true };
  }

  arrive(auth: AuthContext, tripId: string, stopId: string) {
    return this.database.run(auth, (tx) => this.arriveTx(tx, tripId, stopId));
  }

  pod(auth: AuthContext, tripId: string, stopId: string, input: z.infer<typeof podSchema>) {
    return this.database.run(auth, (tx) => this.podTx(tx, tripId, stopId, input));
  }

  fail(auth: AuthContext, tripId: string, stopId: string, input: z.infer<typeof failSchema>) {
    return this.database.run(auth, (tx) => this.failTx(tx, tripId, stopId, input));
  }

  /** Positions from a GPS / FASTag integration (API key) or staff. */
  position(auth: AuthContext, tripId: string, input: z.infer<typeof positionSchema>) {
    return this.database.run(auth, (tx) => this.positionTx(tx, auth.tenantId, tripId, input));
  }

  /** The driver's link: the token carries the workspace, so it resolves under that workspace's row security. */
  private async driverTrip<T>(token: string, fn: (tx: Transaction, tripId: string, tenantId: string) => Promise<T>) {
    const tenantId = token.split('.')[0];
    if (!UUID.test(tenantId)) throw new NotFoundException('This trip link is not valid');
    return this.database.run({ tenantId, userId: null as unknown as string }, async (tx) => {
      const [t] = await tx.select({ id: tmsTrips.id }).from(tmsTrips).where(eq(tmsTrips.driverTokenHash, sha256(token)));
      if (!t) throw new NotFoundException('This trip link is not valid or the trip has ended');
      return fn(tx, t.id, tenantId);
    });
  }

  driverView(token: string) {
    return this.driverTrip(token, (tx, id) => this.view(tx, id, true));
  }

  driverArrive(token: string, stopId: string) {
    return this.driverTrip(token, (tx, id) => this.arriveTx(tx, id, stopId));
  }

  driverPod(token: string, stopId: string, input: z.infer<typeof podSchema>) {
    return this.driverTrip(token, (tx, id) => this.podTx(tx, id, stopId, input));
  }

  driverFail(token: string, stopId: string, input: z.infer<typeof failSchema>) {
    return this.driverTrip(token, (tx, id) => this.failTx(tx, id, stopId, input));
  }

  driverPosition(token: string, input: z.infer<typeof positionSchema>) {
    return this.driverTrip(token, (tx, id, tenantId) => this.positionTx(tx, tenantId, id, { ...input, source: 'driver' }));
  }

  // ---- freight bills ------------------------------------------------------------------------------

  /** Completed trips of a transporter not yet billed, with their computed freight and expenses. */
  billable(auth: AuthContext, transporterId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.number, t.trip_date as "tripDate", t.vehicle_no as "vehicleNo", t.freight_amount as "freightAmount", t.freight_basis as "freightBasis",
                   coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(t.expenses) e), 0)::text as expenses
            from tms_trips t where t.transporter_id = ${transporterId} and t.status = 'completed' and t.freight_bill_id is null order by t.trip_date`,
      ),
    );
  }

  bills(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select b.id, b.number, b.bill_no as "billNo", b.bill_date as "billDate", p.name as transporter, b.claimed_amount as "claimedAmount", b.computed_amount as "computedAmount", b.difference, b.status, b.decision_note as "decisionNote", jsonb_array_length(b.lines) as trips from tms_freight_bills b join tms_transporters t on t.id = b.transporter_id join parties p on p.id = t.party_id where true ${status ? sql`and b.status = ${status}` : sql``} order by b.created_at desc limit 200`),
    );
  }

  /** Records a transporter's bill against completed trips; computed = contract freight + expenses on each trip. */
  createBill(auth: AuthContext, input: z.infer<typeof billSchema>) {
    return this.database.run(auth, async (tx) => {
      const ids = input.lines.map((l) => l.tripId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('A trip appears twice');
      const trips = await many<{ id: string; number: string; transporterId: string | null; status: string; freightBillId: string | null; freightAmount: string | null; expenses: string }>(
        tx,
        sql`select t.id, t.number, t.transporter_id as "transporterId", t.status, t.freight_bill_id as "freightBillId", t.freight_amount::text as "freightAmount",
                   coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(t.expenses) e), 0)::text as expenses
            from tms_trips t where t.id in ${ids} for update`,
      );
      for (const id of ids) {
        const t = trips.find((x) => x.id === id);
        if (!t) throw new NotFoundException('Trip not found');
        if (t.transporterId !== input.transporterId) throw new BadRequestException(`Trip ${t.number} was not run by this transporter`);
        if (t.status !== 'completed') throw new BadRequestException(`Trip ${t.number} is not completed`);
        if (t.freightBillId) throw new ConflictException(`Trip ${t.number} is already billed`);
      }
      const [dup] = await tx.select({ number: tmsFreightBills.number }).from(tmsFreightBills).where(and(eq(tmsFreightBills.transporterId, input.transporterId), eq(tmsFreightBills.billNo, input.billNo)));
      if (dup) throw new ConflictException(`Bill ${input.billNo} is already recorded as ${dup.number}`);
      const lines = input.lines.map((l) => {
        const t = trips.find((x) => x.id === l.tripId)!;
        return { tripId: t.id, number: t.number, computed: (Number(t.freightAmount ?? 0) + Number(t.expenses)).toFixed(2), claimed: l.claimed.toFixed(2) };
      });
      const claimed = lines.reduce((s, l) => s + Number(l.claimed), 0);
      const computed = lines.reduce((s, l) => s + Number(l.computed), 0);
      const number = await nextCode(tx, auth.tenantId, 'tms_freight_bill', 'FB', 5);
      const [b] = await tx
        .insert(tmsFreightBills)
        .values({ tenantId: auth.tenantId, number, transporterId: input.transporterId, billNo: input.billNo, billDate: input.billDate, claimedAmount: claimed.toFixed(2), computedAmount: computed.toFixed(2), difference: (claimed - computed).toFixed(2), lines, createdBy: auth.userId })
        .returning();
      await tx.update(tmsTrips).set({ freightBillId: b.id }).where(inArray(tmsTrips.id, ids));
      return b;
    });
  }

  decideBill(auth: AuthContext, id: string, input: z.infer<typeof decideBillSchema>) {
    return this.database.run(auth, async (tx) => {
      const [b] = await tx.select().from(tmsFreightBills).where(eq(tmsFreightBills.id, id)).for('update');
      if (!b) throw new NotFoundException('Freight bill not found');
      if (b.status !== 'pending') throw new ConflictException(`The bill is already ${b.status}`);
      if (b.createdBy === auth.userId) throw new ConflictException('Someone other than the person who recorded the bill must decide it');
      if (input.approve && Number(b.difference) > 0 && !input.note) throw new BadRequestException(`The bill is ₹${b.difference} above the contract; give a reason to approve it`);
      if (!input.approve) {
        if (!input.note) throw new BadRequestException('Say why the bill is disputed');
        // Disputed trips can be billed again.
        await tx.update(tmsTrips).set({ freightBillId: null }).where(eq(tmsTrips.freightBillId, id));
      }
      return (await tx.update(tmsFreightBills).set({ status: input.approve ? 'approved' : 'disputed', decisionNote: input.note ?? null, decidedBy: auth.userId }).where(eq(tmsFreightBills.id, id)).returning())[0];
    });
  }
}

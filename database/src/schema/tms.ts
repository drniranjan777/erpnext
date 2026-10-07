import { boolean, doublePrecision, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { parties, warehouses } from './masters';
import { tenantId } from './tenancy';

/** A transport vendor: a party with its GST transporter ID (TRANSIN) for e-way bills. */
export const tmsTransporters = pgTable(
  'tms_transporters',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    transporterGstId: text('transporter_gst_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tms_transporters_party_uq').on(t.partyId)],
);

export const tmsVehicles = pgTable(
  'tms_vehicles',
  {
    id: pk(),
    tenantId: tenantId(),
    regNo: citext('reg_no').notNull(),
    /** own | hired */
    ownership: text('ownership').notNull().default('hired'),
    /** e.g. tata_ace, 407, 14ft, 17ft, 20ft, 32ft_sxl, 32ft_mxl, trailer, tanker */
    vehicleType: text('vehicle_type').notNull(),
    capacityKg: numeric('capacity_kg', { precision: 10, scale: 1 }),
    capacityM3: numeric('capacity_m3', { precision: 8, scale: 2 }),
    transporterId: uuid('transporter_id').references(() => tmsTransporters.id, { onDelete: 'set null' }),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('tms_vehicles_reg_uq').on(t.tenantId, t.regNo)],
);

export const tmsRateContracts = pgTable('tms_rate_contracts', {
  id: pk(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  transporterId: uuid('transporter_id')
    .notNull()
    .references(() => tmsTransporters.id, { onDelete: 'restrict' }),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to').notNull(),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One lane: from / to (city or state code; blank = any), vehicle type (blank = any), how it is charged. */
export const tmsRates = pgTable(
  'tms_rates',
  {
    id: pk(),
    tenantId: tenantId(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => tmsRateContracts.id, { onDelete: 'cascade' }),
    fromCity: citext('from_city'),
    fromState: text('from_state'),
    toCity: citext('to_city'),
    toState: text('to_state'),
    vehicleType: text('vehicle_type'),
    /** per_kg | per_trip | per_km */
    basis: text('basis').notNull(),
    rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
    minCharge: numeric('min_charge', { precision: 12, scale: 2 }),
    /** Charge for each drop after the first. */
    perStop: numeric('per_stop', { precision: 10, scale: 2 }),
  },
  (t) => [index('tms_rates_contract_idx').on(t.contractId)],
);

/** A trip sheet: one vehicle, one or more drops (delivery notes). */
export const tmsTrips = pgTable(
  'tms_trips',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    tripDate: text('trip_date').notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    transporterId: uuid('transporter_id').references(() => tmsTransporters.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => tmsVehicles.id, { onDelete: 'set null' }),
    vehicleNo: text('vehicle_no').notNull(),
    vehicleType: text('vehicle_type'),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    /** planned | dispatched | completed | cancelled */
    status: text('status').notNull().default('planned'),
    plannedKm: integer('planned_km'),
    odometerStart: integer('odometer_start'),
    odometerEnd: integer('odometer_end'),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }),
    rateId: uuid('rate_id').references(() => tmsRates.id, { onDelete: 'set null' }),
    freightAmount: numeric('freight_amount', { precision: 12, scale: 2 }),
    freightBasis: text('freight_basis'),
    /** [{kind: toll|fuel|loading|other, amount, note}] */
    expenses: jsonb('expenses').$type<{ kind: string; amount: string; note?: string | null }[]>().notNull().default([]),
    /** Hash of the driver's link token. */
    driverTokenHash: text('driver_token_hash'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    freightBillId: uuid('freight_bill_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tms_trips_number_uq').on(t.tenantId, t.number), uniqueIndex('tms_trips_token_uq').on(t.driverTokenHash), index('tms_trips_date_idx').on(t.tenantId, t.tripDate)],
);

export const tmsStops = pgTable(
  'tms_stops',
  {
    id: pk(),
    tenantId: tenantId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => tmsTrips.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    deliveryId: uuid('delivery_id').references(() => documents.id, { onDelete: 'set null' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    city: text('city'),
    stateCode: text('state_code'),
    address: text('address'),
    /** pending | arrived | delivered | failed */
    status: text('status').notNull().default('pending'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    receivedBy: text('received_by'),
    signature: text('signature'),
    photo: text('photo'),
    note: text('note'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
  },
  (t) => [index('tms_stops_trip_idx').on(t.tripId, t.seq), index('tms_stops_delivery_idx').on(t.deliveryId)],
);

/** Where the vehicle was: from the driver's phone or a GPS / FASTag feed. */
export const tmsPositions = pgTable(
  'tms_positions',
  {
    id: pk(),
    tenantId: tenantId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => tmsTrips.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    speedKmh: numeric('speed_kmh', { precision: 6, scale: 1 }),
    /** driver | gps | fastag */
    source: text('source').notNull().default('driver'),
  },
  (t) => [index('tms_positions_trip_idx').on(t.tripId, t.at)],
);

/** A transporter's bill for trips, checked against the freight worked out from the contract. */
export const tmsFreightBills = pgTable(
  'tms_freight_bills',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    transporterId: uuid('transporter_id')
      .notNull()
      .references(() => tmsTransporters.id, { onDelete: 'restrict' }),
    billNo: text('bill_no').notNull(),
    billDate: text('bill_date').notNull(),
    claimedAmount: numeric('claimed_amount', { precision: 12, scale: 2 }).notNull(),
    computedAmount: numeric('computed_amount', { precision: 12, scale: 2 }).notNull(),
    difference: numeric('difference', { precision: 12, scale: 2 }).notNull(),
    /** Per trip: [{tripId, number, computed, claimed}] */
    lines: jsonb('lines').$type<{ tripId: string; number: string; computed: string; claimed: string }[]>().notNull(),
    /** pending | approved | disputed */
    status: text('status').notNull().default('pending'),
    decisionNote: text('decision_note'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tms_freight_bills_number_uq').on(t.tenantId, t.number), uniqueIndex('tms_freight_bills_bill_uq').on(t.transporterId, t.billNo)],
);

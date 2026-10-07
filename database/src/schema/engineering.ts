import { date, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { items } from './masters';
import { tenantId } from './tenancy';

// =============================================================================
// Engineering change (doc type "engineering_change")
// =============================================================================

/**
 * An engineering change request: raised as a draft, approved through the document workflow
 * (it is then the change notice), and marked implemented once the new BOM / formula /
 * drawing versions it points at are approved.
 */
export const engineeringChanges = pgTable('engineering_changes', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  /** bom | formula | drawing | item | process */
  kind: text('kind').notNull(),
  reason: text('reason').notNull(),
  description: text('description'),
  /** low | normal | high | urgent */
  priority: text('priority').notNull().default('normal'),
  effectiveDate: date('effective_date', { mode: 'string' }),
  /** What happens to existing stock and open orders: use_as_is | rework | scrap | return_to_vendor */
  disposition: text('disposition').notNull().default('use_as_is'),
  /** request (draft / in approval) | approved | implemented */
  stage: text('stage').notNull().default('request'),
  implementedAt: timestamp('implemented_at', { withTimezone: true }),
  implementationNotes: text('implementation_notes'),
  /** Impact as it was when the change was approved. */
  impactSnapshot: jsonb('impact_snapshot').$type<Record<string, unknown>>(),
});

export const engineeringChangeItems = pgTable(
  'engineering_change_items',
  {
    id: pk(),
    tenantId: tenantId(),
    changeId: uuid('change_id')
      .notNull()
      .references(() => engineeringChanges.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    /** The BOM / formula / drawing in use now. */
    fromDocId: uuid('from_doc_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Its new version (usually a draft until the change is implemented). */
    toDocId: uuid('to_doc_id').references(() => documents.id, { onDelete: 'set null' }),
    remarks: text('remarks'),
  },
  (t) => [index('eci_change_idx').on(t.changeId), index('eci_item_idx').on(t.tenantId, t.itemId)],
);

// =============================================================================
// Drawing register (doc type "drawing")
// =============================================================================

/**
 * One row per drawing revision. Approval releases it and supersedes the previous released
 * revision of the same number. Files are document attachments.
 */
export const drawings = pgTable(
  'drawings',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    drawingNo: citext('drawing_no').notNull(),
    revision: text('revision').notNull(),
    title: text('title').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    sheetSize: text('sheet_size'),
    previousId: uuid('previous_id').references((): AnyPgColumn => drawings.id, { onDelete: 'set null' }),
    changeId: uuid('change_id').references(() => engineeringChanges.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('drawings_no_rev_uq').on(t.tenantId, t.drawingNo, t.revision), index('drawings_item_idx').on(t.tenantId, t.itemId)],
);

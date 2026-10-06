import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { rupeesInWords } from '../../common/amount-in-words';
import { DOC_TYPES, isDocType, printFormats, type Transaction } from '@nextgen/database';
import { and, asc, eq, ne } from 'drizzle-orm';
import Handlebars from 'handlebars';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { DocumentsService } from '../documents/documents.service';
import { BASE_CSS, DEFAULT_TEMPLATES, SAMPLE_CONTEXT } from './default-templates';

export const printFormatSchema = z.object({
  docType: z.string().refine(isDocType, 'Unknown document type'),
  name: z.string().trim().min(2).max(60),
  template: z.string().min(10).max(100_000),
  css: z.string().max(50_000).default(''),
  paperSize: z.enum(['A4', 'A5', 'Letter']).default('A4'),
  isDefault: z.boolean().default(false),
});
export type PrintFormatInput = z.infer<typeof printFormatSchema>;
export const updatePrintFormatSchema = printFormatSchema.omit({ docType: true }).partial().extend({ version: z.number().int() });
export type UpdatePrintFormatInput = z.infer<typeof updatePrintFormatSchema>;

/** Builds the template context for one document (registered by each module). */
export type PrintContextProvider = (tx: Transaction, auth: AuthContext, documentId: string) => Promise<Record<string, unknown>>;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });

/** Isolated Handlebars instance: only our helpers, prototype access disabled (Handlebars default). */
const hbs = Handlebars.create();
hbs.registerHelper('money', (v: unknown) => (v === null || v === undefined || v === '' ? '—' : inr.format(Number(v))));
hbs.registerHelper('qty', (v: unknown) => (v === null || v === undefined || v === '' ? '—' : qty.format(Number(v))));
hbs.registerHelper('date', (v: unknown) => {
  if (!v || typeof v !== 'string') return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: v.length === 10 ? 'UTC' : 'Asia/Kolkata' });
});
hbs.registerHelper('datetime', (v: unknown) =>
  v ? new Date(String(v)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—',
);
hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hbs.registerHelper('upper', (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : v));
hbs.registerHelper('inc', (v: unknown) => Number(v) + 1);
hbs.registerHelper('words', (v: unknown) => rupeesInWords(v as string));
hbs.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));

@Injectable()
export class PrintService {
  private readonly providers = new Map<string, PrintContextProvider>();

  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  registerContext(docType: string, provider: PrintContextProvider) {
    this.providers.set(docType, provider);
  }

  builtIn(docType: string) {
    const template = DEFAULT_TEMPLATES[docType];
    if (!template) throw new NotFoundException('No built-in template for this document type');
    return { template, css: '/* Base styles (A4 layout, tables, signatures) are always included. Add overrides here. */\n' };
  }

  /** Renders a document with the chosen (or default) format into a full HTML page. */
  async renderDocument(auth: AuthContext, documentId: string, formatId?: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.getForReader(tx, auth, documentId);
      const provider = this.providers.get(doc.docType);
      if (!provider) throw new NotFoundException('Printing is not available for this document type yet');
      const format = await this.pickFormat(tx, doc.docType, formatId);
      const context = await provider(tx, auth, documentId);
      const formats = await tx
        .select({ id: printFormats.id, name: printFormats.name, isDefault: printFormats.isDefault })
        .from(printFormats)
        .where(eq(printFormats.docType, doc.docType))
        .orderBy(asc(printFormats.name));
      return {
        html: this.render(format.template, format.css, context, format.paperSize),
        formatId: format.id,
        formats: [{ id: null, name: 'Standard (built-in)', isDefault: !formats.some((f) => f.isDefault) }, ...formats],
        title: String((context.doc as { displayNumber?: string })?.displayNumber ?? 'Document'),
      };
    });
  }

  /** Live preview in the designer: renders against a real document or sample data. */
  async preview(auth: AuthContext, input: { docType: string; template: string; css: string; documentId?: string }) {
    let context: Record<string, unknown> = SAMPLE_CONTEXT[input.docType] ?? {};
    if (input.documentId) {
      context = await this.database.run(auth, async (tx) => {
        await this.documents.getForReader(tx, auth, input.documentId!);
        const provider = this.providers.get(input.docType);
        return provider ? provider(tx, auth, input.documentId!) : context;
      });
    }
    return { html: this.render(input.template, input.css, context, 'A4') };
  }

  render(template: string, css: string, context: Record<string, unknown>, paperSize: string) {
    let body: string;
    try {
      body = hbs.compile(template, { strict: false, noEscape: false })(context);
    } catch (err) {
      throw new BadRequestException({ message: 'Template error', errors: [{ path: 'template', message: (err as Error).message.split('\n')[0] }] });
    }
    const size = paperSize === 'A5' ? 'A5' : paperSize === 'Letter' ? 'letter' : 'A4';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${hbs.escapeExpression(String((context.doc as { displayNumber?: string })?.displayNumber ?? 'Print'))}</title><style>${BASE_CSS}\n@page { size: ${size}; }\n${css.replace(/<\/style/gi, '')}</style></head><body>${body}</body></html>`;
  }

  // ---- Admin CRUD -------------------------------------------------------------------

  list(auth: AuthContext, docType?: string) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select()
        .from(printFormats)
        .where(docType ? eq(printFormats.docType, docType) : undefined)
        .orderBy(asc(printFormats.docType), asc(printFormats.name));
      return rows.map((r) => ({ ...r, docTypeLabel: isDocType(r.docType) ? DOC_TYPES[r.docType].label : r.docType }));
    });
  }

  async create(auth: AuthContext, input: PrintFormatInput, meta: RequestMeta) {
    await this.entitlements.assertFeature(auth.tenantId, 'print_designer');
    this.render(input.template, input.css, SAMPLE_CONTEXT[input.docType] ?? {}, input.paperSize); // compile check
    return this.database.run(auth, async (tx) => {
      await this.assertNameFree(tx, input.docType, input.name);
      if (input.isDefault) await tx.update(printFormats).set({ isDefault: false }).where(eq(printFormats.docType, input.docType));
      const [row] = await tx
        .insert(printFormats)
        .values({ ...input, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId })
        .returning();
      await this.log(tx, auth, 'platform.print_format.created', row.id, { docType: row.docType, name: row.name }, meta);
      return row;
    });
  }

  async update(auth: AuthContext, id: string, input: UpdatePrintFormatInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(printFormats).where(eq(printFormats.id, id));
      if (!before) throw new NotFoundException('Print format not found');
      if (before.version !== input.version) throw new ConflictException('This format was changed by someone else. Reload and try again.');
      if (input.template !== undefined || input.css !== undefined) {
        this.render(input.template ?? before.template, input.css ?? before.css, SAMPLE_CONTEXT[before.docType] ?? {}, 'A4');
      }
      if (input.name && input.name !== before.name) await this.assertNameFree(tx, before.docType, input.name, id);
      if (input.isDefault) await tx.update(printFormats).set({ isDefault: false }).where(and(eq(printFormats.docType, before.docType), ne(printFormats.id, id)));
      const { version: _v, ...patch } = input;
      const [row] = await tx
        .update(printFormats)
        .set({ ...patch, updatedBy: auth.userId, version: before.version + 1 })
        .where(and(eq(printFormats.id, id), eq(printFormats.version, before.version)))
        .returning();
      await this.log(tx, auth, 'platform.print_format.updated', id, { name: row.name, fields: Object.keys(patch) }, meta);
      return row;
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.database.run(auth, async (tx) => {
      const [row] = await tx.delete(printFormats).where(eq(printFormats.id, id)).returning({ name: printFormats.name });
      if (!row) throw new NotFoundException('Print format not found');
      await this.log(tx, auth, 'platform.print_format.deleted', id, { name: row.name }, meta);
    });
  }

  private async pickFormat(tx: Transaction, docType: string, formatId?: string) {
    if (formatId) {
      const [f] = await tx.select().from(printFormats).where(and(eq(printFormats.id, formatId), eq(printFormats.docType, docType)));
      if (!f) throw new NotFoundException('Print format not found');
      return f;
    }
    const [def] = await tx.select().from(printFormats).where(and(eq(printFormats.docType, docType), eq(printFormats.isDefault, true)));
    if (def) return def;
    const builtIn = this.builtIn(docType);
    return { id: null, template: builtIn.template, css: '', paperSize: 'A4' };
  }

  private async assertNameFree(tx: Transaction, docType: string, name: string, exceptId?: string) {
    const rows = await tx.select({ id: printFormats.id, name: printFormats.name }).from(printFormats).where(eq(printFormats.docType, docType));
    if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`A print format named "${name}" already exists`);
    }
  }

  private async log(tx: Transaction, auth: AuthContext, action: string, id: string, metadata: Record<string, unknown>, meta: RequestMeta) {
    await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action, entityType: 'print_format', entityId: id, metadata, ...meta });
  }
}

import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

export const MAX_IMPORT_ROWS = 5000;

export interface ParsedSheet {
  /** Normalised header keys (lower_snake_case), in column order. */
  headers: string[];
  /** One record per non-empty data row, keyed by normalised header. */
  rows: { rowNo: number; values: Record<string, string> }[];
}

/** "Item Code", "item-code", "ITEM_CODE " → "item_code". */
export function normaliseHeader(h: string) {
  return h
    .replace(/\*/g, '')
    .trim()
    .toLowerCase()
    .replace(/%/g, ' percent')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function parseSheet(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  const lower = fileName.toLowerCase();
  let table: string[][];
  if (lower.endsWith('.xlsx')) table = await readXlsx(buffer);
  else if (lower.endsWith('.csv') || lower.endsWith('.txt')) table = parseCsv(decodeText(buffer));
  else if (lower.endsWith('.xls')) throw new BadRequestException('Old .xls files are not supported. Save the file as .xlsx or .csv and upload again.');
  else throw new BadRequestException('Upload an Excel (.xlsx) or CSV file');

  // The header is the first row that has at least two filled cells (templates may start with a title row).
  const headerIdx = table.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
  if (headerIdx < 0) throw new BadRequestException('The file has no header row');
  const headers = table[headerIdx].map(normaliseHeader);
  const rows: ParsedSheet['rows'] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells.some((c) => c.trim())) continue;
    // Rows starting with "#" are comments (template help lines).
    if (cells[0]?.trim().startsWith('#')) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, c) => {
      if (h) values[h] = (cells[c] ?? '').trim();
    });
    rows.push({ rowNo: i + 1, values });
    if (rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Import up to ${MAX_IMPORT_ROWS} rows at a time. Split the file and upload the parts.`);
  }
  if (!rows.length) throw new BadRequestException('The file has a header but no data rows');
  return { headers, rows };
}

/** Raw cell table of a CSV / XLSX file (no header handling). */
export async function readTable(buffer: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return readXlsx(buffer);
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(decodeText(buffer));
  throw new BadRequestException('Upload a CSV, Excel (.xlsx) or MT940 file');
}

/** UTF-8 (with or without BOM) or UTF-16 (Excel "Unicode text"). */
export function decodeText(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  const s = buffer.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** RFC 4180 CSV. Detects ";" or tab separators (European Excel / TSV exports). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0 || text.length);
  const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('This Excel file could not be read. Save it again as .xlsx and retry.');
  }
  const ws = wb.worksheets.find((w) => w.state === 'visible' && w.rowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new BadRequestException('The workbook has no sheets');
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNo) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
    out[rowNo - 1] = cells;
  });
  return Array.from(out, (r) => r ?? []);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}

/** Builds an .xlsx template: header row, an example row, and a help sheet. */
export async function buildTemplate(
  title: string,
  columns: { key: string; label: string; required?: boolean; help?: string; example?: string }[],
  lists: Record<string, string[]> = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NextGen ERP';
  const ws = wb.addWorksheet(title);
  ws.addRow(columns.map((c) => (c.required ? `${c.label} *` : c.label)));
  ws.addRow(columns.map((c) => c.example ?? ''));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
  ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(12, Math.min(40, c.label.length + 4));
    if (c.help) ws.getCell(1, i + 1).note = c.help;
  });

  const help = wb.addWorksheet('Help');
  help.addRow(['Column', 'Required', 'What to enter']).font = { bold: true };
  for (const c of columns) help.addRow([c.label, c.required ? 'Yes' : '', c.help ?? '']);
  help.addRow([]);
  help.addRow(['Delete the example row (row 2) before uploading, or start it with # to skip it.']);
  for (const [name, values] of Object.entries(lists)) {
    help.addRow([]);
    help.addRow([name]).font = { bold: true };
    for (const v of values) help.addRow([v]);
  }
  help.getColumn(1).width = 28;
  help.getColumn(3).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

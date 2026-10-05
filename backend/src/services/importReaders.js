// Turns whatever file an SME uploads into one table: { headers, rows: [{ line, cells }] }.
//   - CSV / TSV / semicolon or pipe separated text (Excel "Unicode text" UTF-16 too)
//   - Excel (.xlsx, .xls, .xlsm), OpenDocument (.ods) and other spreadsheets SheetJS reads
//   - JSON (an array of objects, or an object holding one)
//   - Screenshots, photos and PDFs, read by AI (services/screenshotReader.js)
// `line` is the row number the user sees in their own file, so skipped-row messages point at it.
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { mapHeaders, parseDate, parseMoney } from './dealImport.js';
import { EXTRACT_FIELDS, IMAGE_TYPES, PDF_TYPE, ReadError, readTableWithAi } from './screenshotReader.js';

export { ReadError };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit, and plenty for a local model

const SPREADSHEET_EXT = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'numbers'];
const TEXT_EXT = ['csv', 'tsv', 'tab', 'txt', 'text', 'psv'];
const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export const ACCEPTED_DESCRIPTION = 'CSV, Excel (.xlsx/.xls), OpenDocument (.ods), text, JSON, PDF, or a screenshot (PNG/JPG/WebP)';

const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const cellText = (v) => (v === null || v === undefined ? '' : String(v).trim());
const isBlank = (cells) => cells.every((c) => c === '');

// What kind of file is it? Extension first, then the browser's type, then the first bytes.
function detectKind(file) {
  const ext = extOf(file.originalname);
  const mime = (file.mimetype || '').toLowerCase();
  const b = file.buffer;
  if (IMAGE_EXT[ext] || IMAGE_TYPES.includes(mime)) return { kind: 'image', mediaType: IMAGE_EXT[ext] || mime };
  if (ext === 'pdf' || mime === PDF_TYPE || b.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf' };
  if (SPREADSHEET_EXT.includes(ext) || /spreadsheet|excel|opendocument/.test(mime)) return { kind: 'spreadsheet' };
  if (ext === 'json' || mime === 'application/json') return { kind: 'json' };
  if (TEXT_EXT.includes(ext) || mime.startsWith('text/')) return { kind: 'text' };
  if (['docx', 'doc', 'pptx', 'ppt'].includes(ext)) return { kind: 'unsupported', hint: ' Save it as a PDF, or take a screenshot of the table.' };
  // Unknown extension: zip (xlsx/ods) and old OLE (xls) files are spreadsheets
  if (b[0] === 0x50 && b[1] === 0x4b) return { kind: 'spreadsheet' };
  if (b[0] === 0xd0 && b[1] === 0xcf) return { kind: 'spreadsheet' };
  if (b[0] === 0x89 && b[1] === 0x50) return { kind: 'image', mediaType: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8) return { kind: 'image', mediaType: 'image/jpeg' };
  // Anything else: try it as text if it looks like text
  if (!b.subarray(0, 1024).includes(0)) return { kind: 'text' };
  return { kind: 'unsupported', hint: '' };
}

// Real exports often start with a title or logo rows. Use the first row (of the first 15) where
// at least two headings are ones we recognise, else the first row that fills most of the table. If that row is
// clearly data (it has an amount or a date in it), the file has no heading row: every row is data
// and the columns are named "Column 1", "Column 2", ... for the column matcher to work out.
const looksLikeData = (cells) => cells.some((c) => c && (!Number.isNaN(parseMoney(c)) || parseDate(c)));

function splitHeader(lines) {
  const nonBlank = lines.filter((l) => !isBlank(l.cells));
  if (!nonBlank.length) return { headers: [], rows: [] };
  const candidates = nonBlank.slice(0, 15);
  let headerAt = candidates.findIndex((l) => mapHeaders(l.cells).filter(Boolean).length >= 2);
  if (headerAt === -1) {
    // Headings we don't know: skip title lines ("SALES MARCH 2026") by taking the first row that
    // fills most of the table's width
    const filled = (l) => l.cells.filter(Boolean).length;
    const widest = Math.max(...candidates.map(filled));
    headerAt = Math.max(0, candidates.findIndex((l) => filled(l) >= Math.max(2, Math.ceil(widest * 0.6))));
    if (looksLikeData(nonBlank[headerAt].cells)) {
      const width = Math.max(...nonBlank.map((l) => l.cells.length));
      return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: nonBlank.slice(headerAt) };
    }
  }
  return { headers: nonBlank[headerAt].cells, rows: nonBlank.slice(headerAt + 1) };
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  return buffer.toString('utf-8').replace(/^﻿/, '');
}

// The separator that appears most often outside quotes on the first few lines
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).map((l) => l.replace(/"[^"]*"/g, ''));
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t', '|']) {
    const count = Math.min(...sample.map((l) => l.split(d).length - 1));
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

function readText(buffer) {
  const text = decodeText(buffer);
  let records;
  try {
    records = parse(text, { delimiter: detectDelimiter(text), relax_column_count: true, relax_quotes: true, trim: true, info: true });
  } catch (err) {
    throw new ReadError(`Could not read the file: ${err.message}`);
  }
  return splitHeader(records.map(({ record, info }) => ({ line: info.lines, cells: record.map(cellText) })));
}

const ymd = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Date cells become YYYY-MM-DD (so 3/4/26 in a US-formatted sheet can't be misread); numbers keep
// full precision; everything else is the text shown in the cell.
function spreadsheetCell(cell) {
  if (!cell) return '';
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const parsed = XLSX.SSF.parse_date_code(cell.v);
    if (parsed) return ymd(parsed);
  }
  if (cell.t === 'n') return String(cell.v);
  return cellText(cell.w ?? cell.v);
}

function readSpreadsheet(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true });
  } catch (err) {
    throw new ReadError(`Could not open the spreadsheet: ${err.message}`);
  }
  // First sheet that has a recognisable header, else the first sheet with any data
  let fallback = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const lines = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = [];
      for (let c = range.s.c; c <= range.e.c; c++) cells.push(spreadsheetCell(sheet[XLSX.utils.encode_cell({ r, c })]));
      lines.push({ line: r + 1, cells });
    }
    const table = splitHeader(lines);
    const recognised = mapHeaders(table.headers).filter(Boolean).length;
    if (recognised >= 2) return { ...table, sheet: workbook.SheetNames.length > 1 ? name : undefined };
    if (!fallback && table.rows.length) fallback = { ...table, sheet: workbook.SheetNames.length > 1 ? name : undefined };
  }
  return fallback ?? { headers: [], rows: [] };
}

function readJson(buffer) {
  let data;
  try {
    data = JSON.parse(decodeText(buffer));
  } catch (err) {
    throw new ReadError(`Could not read the JSON: ${err.message}`);
  }
  if (!Array.isArray(data) && data && typeof data === 'object') data = Object.values(data).find(Array.isArray) ?? [data];
  if (!Array.isArray(data)) throw new ReadError('The JSON file should hold a list of deals');
  if (data.every(Array.isArray)) return splitHeader(data.map((cells, i) => ({ line: i + 1, cells: cells.map(cellText) })));

  const objects = data.filter((d) => d && typeof d === 'object');
  const headers = [...new Set(objects.flatMap(Object.keys))];
  return { headers, rows: objects.map((o, i) => ({ line: i + 1, cells: headers.map((h) => cellText(o[h])) })) };
}

async function readWithAi(file, mediaType, { includeOwner }) {
  if (mediaType !== PDF_TYPE && file.buffer.length > MAX_IMAGE_BYTES) {
    throw new ReadError('Screenshots must be under 5 MB. Crop it or save it as a JPG.');
  }
  const { rows, notes } = await readTableWithAi(file.buffer, mediaType);
  const headers = includeOwner ? EXTRACT_FIELDS : EXTRACT_FIELDS.filter((f) => f !== 'owner');
  return {
    headers,
    rows: rows.map((r, i) => ({ line: i + 1, cells: headers.map((h) => cellText(r[h])) })),
    notes,
  };
}

// file (from multer) -> { headers, rows: [{ line, cells }], readBy: 'file' | 'ai', notes, sheet? }
// includeOwner: whether a picture's "salesperson" column should be read (managers only)
export async function readImportFile(file, { includeOwner = false } = {}) {
  const detected = detectKind(file);
  switch (detected.kind) {
    case 'image':
      return { ...(await readWithAi(file, detected.mediaType, { includeOwner })), readBy: 'ai' };
    case 'pdf':
      return { ...(await readWithAi(file, PDF_TYPE, { includeOwner })), readBy: 'ai' };
    case 'spreadsheet':
      return { ...readSpreadsheet(file.buffer), readBy: 'file', notes: [] };
    case 'json':
      return { ...readJson(file.buffer), readBy: 'file', notes: [] };
    case 'text':
      return { ...readText(file.buffer), readBy: 'file', notes: [] };
    default:
      throw new ReadError(`That type of file can't be imported.${detected.hint} Use ${ACCEPTED_DESCRIPTION}.`);
  }
}

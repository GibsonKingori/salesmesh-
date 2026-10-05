// Works out which of the user's columns hold which deal details, and what their own status words
// mean, so any business can upload its records as they are.
//   1. Known headings ("Amount", "Customer", ...) are matched directly (dealImport.mapHeaders).
//   2. If that leaves the file's main details unmatched, or status words we don't know, the AI
//      (services/ai.js) looks at the headings and a few sample rows and matches the rest.
//   3. The preview shows the result and the user can change any column; that mapping is sent back
//      (parseClientMapping) so the import uses exactly what was checked, without asking the AI again.
import { VALID_STAGES } from './dealUpdates.js';
import { IMPORT_FIELDS, mapHeaders, parseDate, parseMoney, parseStage, simplify } from './dealImport.js';
import { askAiJson, ReadError } from './ai.js';

const SAMPLE_ROWS = 8;
const MAX_DISTINCT = 15; // columns with this few different values are listed in full (status columns)

const FIELD_HELP = {
  title: 'what was sold or the deal name (product, service, item, description, order)',
  value: 'the money amount of the sale or deal',
  stage: 'status / stage of the deal or sale (paid, pending, cancelled, ...)',
  created_date: 'when the enquiry, order or deal started (or the only date on a sales record)',
  closed_date: 'when the sale was completed, paid or lost',
  expected_close_date: 'when an open deal is expected to close',
  close_date: 'a single "close date" column that is actual for finished deals and expected for open ones',
  owner: 'the salesperson / staff member responsible',
  campaign: 'the marketing campaign or source campaign name',
  contact_name: "the customer's name",
  company: "the customer's business or company",
  contact_email: "the customer's email",
  contact_phone: "the customer's phone number",
};

const SCHEMA = {
  type: 'object',
  properties: {
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, field: { type: 'string', enum: [...IMPORT_FIELDS, 'ignore'] } },
        required: ['index', 'field'],
        additionalProperties: false,
      },
    },
    stages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { value: { type: 'string' }, stage: { type: 'string', enum: VALID_STAGES } },
        required: ['value', 'stage'],
        additionalProperties: false,
      },
    },
  },
  required: ['columns', 'stages'],
  additionalProperties: false,
};

const columnValues = (rows, i) => rows.map((r) => String(r.cells[i] ?? '').trim()).filter(Boolean);

// Status words in the stage column that our built-in list doesn't know
function unknownStatuses(rows, columns) {
  const i = columns.indexOf('stage');
  if (i === -1) return [];
  return [...new Set(columnValues(rows, i))].filter((v) => !parseStage(v));
}

function needsAi(table, columns) {
  const unmatchedWithData = table.headers.some((_, i) => !columns[i] && columnValues(table.rows, i).length);
  const missingMain = ['title', 'value', 'stage', 'created_date'].some((f) => !columns.includes(f));
  return unknownStatuses(table.rows, columns).length > 0 || (unmatchedWithData && missingMain);
}

async function matchWithAi(table) {
  const describe = table.headers.map((h, i) => {
    const values = columnValues(table.rows, i);
    const distinct = [...new Set(values)];
    const sample = values.slice(0, SAMPLE_ROWS).map((v) => v.slice(0, 60));
    const all = distinct.length <= MAX_DISTINCT ? ` | all values: ${JSON.stringify(distinct.map((v) => v.slice(0, 60)))}` : '';
    return `${i}. heading ${JSON.stringify(h || '(no heading)')} | examples: ${JSON.stringify(sample)}${all}`;
  });
  const prompt = `A small Kenyan business uploaded its sales records to a CRM. Match each column to the CRM field it holds.

CRM fields:
${IMPORT_FIELDS.map((f) => `- ${f}: ${FIELD_HELP[f]}`).join('\n')}
- ignore: anything else (notes, row numbers, totals, quantities, unit prices when there is also a total, etc.)

Rules: use each field at most once (pick the best column). Headings may be in English, Swahili or abbreviated. If several columns could be the amount, prefer the total for the sale. Return one entry per column index.

Then, for the column you matched to "stage", map every distinct status value you were shown to one of: ${VALID_STAGES.join(', ')}. (won = sale completed/paid/delivered, lost = cancelled/refused/refunded, negotiation = partly paid / deposit / agreeing terms, proposal = quoted/invoiced but unpaid, qualified = interested / followed up, lead = new enquiry.)

Columns:
${describe.join('\n')}`;

  const result = await askAiJson({ prompt, schema: SCHEMA, effort: 'low' });
  const columns = table.headers.map(() => null);
  const used = new Set();
  for (const { index, field } of result.columns ?? []) {
    if (field === 'ignore' || used.has(field) || index < 0 || index >= columns.length || columns[index]) continue;
    columns[index] = field;
    used.add(field);
  }
  // Only words our built-in list doesn't know: a small model shouldn't overrule "Cancelled" -> lost
  const stages = Object.fromEntries((result.stages ?? []).filter((s) => !parseStage(s.value)).map((s) => [simplify(s.value), s.stage]));
  return { columns, stages };
}

// Kenyan mobile and landline numbers: 0712 345 678, +254 712 345678, 020 1234567
const isPhone = (v) => /^(\+?254|0)\d{9}$/.test(v.replace(/[\s()-]/g, ''));

// Without AI: a column of phone numbers is the phone, one that is almost all dates is the date,
// and one that is almost all amounts (with some of at least 100, so not quantities) is the amount
function guessByContent(table, columns) {
  const guessed = [...columns];
  const share = (values, test) => (values.length ? values.filter(test).length / values.length : 0);
  table.headers.forEach((_, i) => {
    if (guessed[i]) return;
    const values = columnValues(table.rows, i);
    if (!values.length) return;
    if (!guessed.includes('contact_phone') && share(values, isPhone) >= 0.7) guessed[i] = 'contact_phone';
    else if (!guessed.includes('created_date') && share(values, (v) => parseDate(v)) >= 0.7) guessed[i] = 'created_date';
    else if (!guessed.includes('value') && share(values, (v) => !Number.isNaN(parseMoney(v))) >= 0.7 && values.some((v) => parseMoney(v) >= 100)) {
      guessed[i] = 'value';
    }
  });
  return guessed;
}

// table: { headers, rows: [{ cells }] } -> { columns: [field|null], stages: {}, mappedBy, notes }
export async function buildMapping(table) {
  const columns = mapHeaders(table.headers);
  if (!needsAi(table, columns)) return { columns, stages: {}, mappedBy: 'headings', notes: [] };
  try {
    return { ...(await matchWithAi(table)), mappedBy: 'ai', notes: [] };
  } catch (err) {
    if (!(err instanceof ReadError)) throw err;
    // Still usable with the headings we know; the user can match the rest in the preview
    return { columns: guessByContent(table, columns), stages: {}, mappedBy: 'headings', notes: [`Automatic column matching is unavailable right now. ${err.message} Match your columns below.`] };
  }
}

// The mapping the browser sends back after the user checked (or changed) it; null if invalid
export function parseClientMapping(json, headers) {
  if (!json) return null;
  let m;
  try {
    m = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  if (!Array.isArray(m?.columns) || m.columns.length !== headers.length) return null;
  const used = new Set();
  const columns = m.columns.map((f) => {
    if (!IMPORT_FIELDS.includes(f) || used.has(f)) return null;
    used.add(f);
    return f;
  });
  const stages = Object.fromEntries(
    Object.entries(m.stages && typeof m.stages === 'object' ? m.stages : {})
      .filter(([, s]) => VALID_STAGES.includes(s))
      .map(([k, s]) => [simplify(k), s])
  );
  return { columns, stages, mappedBy: m.mappedBy === 'ai' ? 'ai' : 'user', notes: [] };
}

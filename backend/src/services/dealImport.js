// Turns rows from an SME's own spreadsheet into SalesMesh deals. Kept dependency-free
// (like analytics.js) so the rules are unit-testable without Supabase.
//
// Real records rarely match our column names, or have every column we would like, so the rules
// adapt instead of rejecting: common heading alternatives, English and Swahili, are accepted ("Deal name",
// "Amount (KES)", "Kiasi", ...), anything else can be matched by services/columnMapper.js, money may include
// "KES", commas or "/=", dates may be ISO, day-first or written out, and a missing deal name,
// amount or status gets a sensible default that the preview tells the user about.
import { VALID_STAGES } from './dealUpdates.js';

export const CLOSED_STAGES = ['won', 'lost'];

// Every field a column can be matched to
export const IMPORT_FIELDS = [
  'title',
  'value',
  'stage',
  'created_date',
  'closed_date',
  'expected_close_date',
  'close_date',
  'owner',
  'campaign',
  'contact_name',
  'company',
  'contact_email',
  'contact_phone',
];

// Our column -> the header spellings we accept (compared lowercased, punctuation stripped)
const HEADER_ALIASES = {
  title: ['title', 'deal', 'deal name', 'deal title', 'opportunity', 'description', 'item', 'items', 'product', 'product name', 'service', 'product service', 'goods', 'bidhaa', 'huduma', 'maelezo ya bidhaa'],
  value: ['value', 'amount', 'deal value', 'amount kes', 'value kes', 'price', 'total', 'kes', 'total amount', 'sale amount', 'sales amount', 'amount paid', 'revenue', 'grand total', 'total kes', 'amount ksh', 'ksh', 'kiasi', 'bei', 'jumla', 'malipo'],
  stage: ['stage', 'status', 'deal stage', 'pipeline stage', 'sale status', 'order status', 'deal status', 'hali'],
  expected_close_date: ['expected close date', 'expected close', 'close date expected', 'target date', 'due date'],
  created_date: ['created date', 'created', 'date created', 'start date', 'date opened', 'opened', 'lead date', 'date', 'order date', 'enquiry date', 'inquiry date', 'tarehe'],
  closed_date: ['closed date', 'closed', 'date closed', 'date won', 'won date', 'date lost', 'closed on', 'sale date', 'date of sale', 'date sold', 'payment date', 'date paid'],
  // CRMs export one "Close date": the actual date for won/lost deals, the expected one otherwise
  close_date: ['close date', 'closing date'],
  // An email or the person's full name as it appears in SalesMesh
  owner: ['owner', 'owner email', 'owner name', 'rep', 'rep email', 'sales rep', 'sales rep email', 'salesperson', 'salesperson email', 'assigned to', 'sold by', 'served by', 'agent', 'muuzaji'],
  campaign: ['campaign', 'campaign name', 'source campaign', 'marketing campaign'],
  contact_name: ['contact name', 'contact', 'customer', 'customer name', 'client', 'client name', 'buyer', 'name', 'mteja', 'jina la mteja', 'mnunuzi'],
  company: ['company', 'business', 'organisation', 'organization', 'company name', 'business name', 'kampuni', 'biashara'],
  contact_email: ['contact email', 'customer email', 'client email', 'email', 'email address'],
  contact_phone: ['contact phone', 'phone', 'phone number', 'mobile', 'customer phone', 'tel', 'telephone', 'mobile number', 'phone no', 'simu', 'nambari ya simu'],
};

const STAGE_ALIASES = {
  lead: ['lead', 'new', 'new lead', 'prospect', 'enquiry', 'inquiry', 'open', 'cold', 'warm'],
  qualified: ['qualified', 'contacted', 'interested', 'qualified lead', 'follow up', 'following up'],
  proposal: ['proposal', 'quote', 'quoted', 'quotation', 'proposal sent', 'quote sent', 'invoice sent'],
  negotiation: ['negotiation', 'negotiating', 'in negotiation', 'pending', 'deposit paid', 'partially paid', 'partly paid', 'deposit', 'amelipa nusu', 'inasubiri'],
  won: ['won', 'closed won', 'closed-won', 'sold', 'paid', 'complete', 'completed', 'deal won', 'done', 'delivered', 'fully paid', 'closed', 'imelipwa', 'limelipwa', 'amelipa', 'imekamilika', 'imeuzwa'],
  lost: ['lost', 'closed lost', 'closed-lost', 'cancelled', 'canceled', 'rejected', 'deal lost', 'declined', 'refunded', 'imeghairiwa', 'imefutwa', 'imekataliwa', 'amekataa'],
};

export const simplify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const headerLookup = new Map(Object.entries(HEADER_ALIASES).flatMap(([field, names]) => names.map((n) => [simplify(n), field])));
const stageLookup = new Map(Object.entries(STAGE_ALIASES).flatMap(([stage, names]) => names.map((n) => [simplify(n), stage])));

// Header row -> our field names; unrecognised columns map to null and are ignored
export function mapHeaders(headers) {
  const seen = new Set();
  return headers.map((h) => {
    const field = headerLookup.get(simplify(h)) ?? null;
    if (!field || seen.has(field)) return null; // first matching column wins
    seen.add(field);
    return field;
  });
}

export function parseStage(raw) {
  return stageLookup.get(simplify(raw)) ?? null;
}

// "KES 1,250,000.50", "1 250 000", "Ksh 500/=", "50k", "1.2M" -> number; anything else -> NaN
export function parseMoney(raw) {
  if (raw === undefined || raw === null) return NaN;
  let cleaned = String(raw)
    .replace(/\/[=-]\s*$/, '') // "500/=" is how amounts are often written in Kenya
    .replace(/\b(k(e)?sh?s?|kes|shs?)\b\.?/gi, '')
    .replace(/[\s,]/g, '');
  let multiplier = 1;
  const suffix = cleaned.match(/^(-?\d+(?:\.\d+)?)([km])$/i);
  if (suffix) {
    cleaned = suffix[1];
    multiplier = suffix[2].toLowerCase() === 'k' ? 1000 : 1000000;
  }
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * multiplier * 100) / 100;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (name) => MONTHS.indexOf(String(name).slice(0, 3).toLowerCase()) + 1;

// Accepts 2026-03-14, 14/03/2026, 14-03-2026, 14.03.2026, 14/03/26 (day first, as in Kenya, unless
// that is impossible: 03/14/2026 can only be 14 March), "14 March 2026", "Mar 14, 2026", "14-Mar-26",
// a time after the date, and Excel's day numbers (46095).
// Returns 'YYYY-MM-DD', '' for a blank cell, or null if it isn't a real date.
export function parseDate(raw) {
  const s = String(raw ?? '').trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?(Z|[+-]\d{2}:?\d{2})?$/i, '');
  if (!s) return '';
  let y;
  let m;
  let d;
  let match;
  if ((match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [, y, m, d] = match.map(Number);
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [, d, m, y] = match.map(Number);
    if (m > 12 && d <= 12) [d, m] = [m, d];
  } else if ((match = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/i))) {
    [d, m, y] = [Number(match[1]), monthOf(match[2]), Number(match[3])];
  } else if ((match = s.match(/^([a-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2}|\d{4})$/i))) {
    [m, d, y] = [monthOf(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d{5}$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    // Excel day number: days since 30 Dec 1899
    const date = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return date.toISOString().slice(0, 10);
  } else return null;
  if (y < 100) y += 2000;
  if (!m) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// A calendar date stored as midday Nairobi time, so it never shifts to the day before or after
export const dateToTimestamp = (ymd) => new Date(`${ymd}T12:00:00+03:00`).toISOString();

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Validates one row (already keyed by our field names) and fills gaps with sensible defaults.
// Returns { row, fixes } or { error }; `fixes` lists what was assumed so the preview can say so.
// Options: today 'YYYY-MM-DD'; stageMap { simplified status text -> stage } (from columnMapper);
// defaultStage for rows with no status; rowNum for generated titles.
export function readDealRow(raw, today, { stageMap = {}, defaultStage = 'won', rowNum } = {}) {
  const fixes = [];
  const company = text(raw.company);
  const contactName = text(raw.contact_name);

  const rawValue = text(raw.value);
  let value = 0;
  if (rawValue) {
    value = parseMoney(rawValue);
    if (Number.isNaN(value) || value < 0) return { error: `Can't read the amount "${rawValue}"` };
  }

  let title = text(raw.title);
  if (!title) {
    if (!rawValue && !company && !contactName) return { error: 'No deal details in this row' };
    title = company || contactName ? `Sale – ${company || contactName}` : `Sale (row ${rowNum ?? '?'})`;
    fixes.push('generatedTitle');
  }
  if (!rawValue) fixes.push('blankValue');

  const rawStage = text(raw.stage);
  // The user's (or AI's) reading of their own status words comes first, then the built-in list
  let stage = rawStage ? stageMap[simplify(rawStage)] ?? parseStage(rawStage) ?? null : null;
  if (!stage || !VALID_STAGES.includes(stage)) {
    fixes.push(rawStage ? 'unknownStage' : 'defaultedStage');
    stage = defaultStage;
  }

  const closed = CLOSED_STAGES.includes(stage);
  const closeField = closed ? 'closed_date' : 'expected_close_date';
  const source = { ...raw };
  if (raw.close_date && !raw[closeField]) source[closeField] = raw.close_date;

  const dates = {};
  for (const field of ['created_date', 'closed_date', 'expected_close_date']) {
    const parsed = parseDate(source[field]);
    if (parsed === null) fixes.push('badDate'); // unreadable date: import the deal without it
    dates[field] = parsed || '';
  }
  if (dates.created_date && dates.created_date > today) return { error: `Created date ${dates.created_date} is in the future` };
  if (dates.closed_date && !closed) {
    // A close date on an open deal is when they hope to close it, if it hasn't passed
    if (dates.closed_date > today && !dates.expected_close_date) dates.expected_close_date = dates.closed_date;
    dates.closed_date = '';
  }
  if (closed) {
    if (dates.closed_date > today) return { error: `Closed date ${dates.closed_date} is in the future` };
    if (!dates.closed_date && dates.created_date) {
      // One date on a sale (a sales book's "Date") is when it happened
      dates.closed_date = dates.created_date;
      fixes.push('closedFromCreated');
    }
    if (dates.created_date && dates.closed_date < dates.created_date) {
      dates.created_date = dates.closed_date;
      fixes.push('createdAfterClosed');
    }
  }

  return {
    row: {
      title,
      value,
      stage,
      ...dates,
      owner: text(raw.owner),
      campaign: text(raw.campaign),
      contact_name: contactName,
      company,
      contact_email: text(raw.contact_email),
      contact_phone: text(raw.contact_phone),
    },
    fixes,
  };
}

// Key used to recognise the same customer across rows and existing contacts
export const contactKey = (name, company) => `${simplify(name)}|${simplify(company)}`;

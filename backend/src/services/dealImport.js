// Turns rows from an SME's own spreadsheet into SalesMesh deals. Kept dependency-free
// (like analytics.js) so the rules are unit-testable without Supabase.
//
// Real records rarely match our column names exactly, so common alternatives are accepted
// ("Deal name", "Amount (KES)", "Date won", ...), money may include "KES" and commas, and
// dates may be ISO (2026-03-14) or Kenyan day-first (14/03/2026).
import { VALID_STAGES } from './dealUpdates.js';

export const CLOSED_STAGES = ['won', 'lost'];

// Our column -> the header spellings we accept (compared lowercased, punctuation stripped)
const HEADER_ALIASES = {
  title: ['title', 'deal', 'deal name', 'deal title', 'opportunity', 'description', 'item'],
  value: ['value', 'amount', 'deal value', 'amount kes', 'value kes', 'price', 'total', 'kes'],
  stage: ['stage', 'status', 'deal stage', 'pipeline stage'],
  expected_close_date: ['expected close date', 'expected close', 'close date expected', 'target date', 'due date'],
  created_date: ['created date', 'created', 'date created', 'start date', 'date opened', 'opened', 'lead date', 'date'],
  closed_date: ['closed date', 'closed', 'date closed', 'date won', 'won date', 'date lost', 'closed on'],
  // CRMs export one "Close date": the actual date for won/lost deals, the expected one otherwise
  close_date: ['close date', 'closing date'],
  // An email or the person's full name as it appears in SalesMesh
  owner: ['owner', 'owner email', 'owner name', 'rep', 'rep email', 'sales rep', 'sales rep email', 'salesperson', 'salesperson email', 'assigned to'],
  campaign: ['campaign', 'campaign name', 'source campaign', 'marketing campaign'],
  contact_name: ['contact name', 'contact', 'customer', 'customer name', 'client', 'client name'],
  company: ['company', 'business', 'organisation', 'organization', 'company name'],
  contact_email: ['contact email', 'customer email', 'client email', 'email'],
  contact_phone: ['contact phone', 'phone', 'phone number', 'mobile', 'customer phone', 'tel'],
};

const STAGE_ALIASES = {
  lead: ['lead', 'new', 'new lead', 'prospect', 'enquiry', 'inquiry', 'open'],
  qualified: ['qualified', 'contacted', 'interested', 'qualified lead'],
  proposal: ['proposal', 'quote', 'quoted', 'quotation', 'proposal sent', 'quote sent'],
  negotiation: ['negotiation', 'negotiating', 'in negotiation', 'pending'],
  won: ['won', 'closed won', 'closed-won', 'sold', 'paid', 'complete', 'completed', 'deal won'],
  lost: ['lost', 'closed lost', 'closed-lost', 'cancelled', 'canceled', 'rejected', 'deal lost'],
};

const simplify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

// "KES 1,250,000.50", "1 250 000", "Ksh 500" -> number; anything else -> NaN
export function parseMoney(raw) {
  if (raw === undefined || raw === null) return NaN;
  const cleaned = String(raw).replace(/k(e)?sh?s?\.?/gi, '').replace(/[\s,]/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

// Accepts 2026-03-14, 14/03/2026, 14-03-2026, 14.03.2026 and 14/03/26 (day first, as in Kenya).
// Returns 'YYYY-MM-DD', '' for a blank cell, or null if it isn't a real date.
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let y;
  let m;
  let d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// A calendar date stored as midday Nairobi time, so it never shifts to the day before or after
export const dateToTimestamp = (ymd) => new Date(`${ymd}T12:00:00+03:00`).toISOString();

// Validates one row (already keyed by our field names). Returns { row } or { error }.
// `today` is 'YYYY-MM-DD'.
export function readDealRow(raw, today) {
  const title = raw.title?.trim();
  if (!title) return { error: 'Missing title' };

  const value = parseMoney(raw.value);
  if (Number.isNaN(value) || value < 0) return { error: `Invalid value "${raw.value ?? ''}"` };

  const stage = parseStage(raw.stage);
  if (!stage || !VALID_STAGES.includes(stage)) return { error: `Unknown stage "${raw.stage ?? ''}"` };

  const closeField = CLOSED_STAGES.includes(stage) ? 'closed_date' : 'expected_close_date';
  const source = { ...raw };
  if (raw.close_date && !raw[closeField]) source[closeField] = raw.close_date;

  const dates = {};
  for (const field of ['created_date', 'closed_date', 'expected_close_date']) {
    const parsed = parseDate(source[field]);
    if (parsed === null) return { error: `Invalid ${field.replace(/_/g, ' ')} "${source[field]}" (use YYYY-MM-DD or DD/MM/YYYY)` };
    dates[field] = parsed;
  }
  if (dates.created_date && dates.created_date > today) return { error: 'Created date is in the future' };
  if (dates.closed_date) {
    if (!CLOSED_STAGES.includes(stage)) return { error: `Closed date given but stage is "${stage}" (only won or lost deals close)` };
    if (dates.closed_date > today) return { error: 'Closed date is in the future' };
    if (dates.created_date && dates.closed_date < dates.created_date) return { error: 'Closed date is before created date' };
  }

  return {
    row: {
      title,
      value,
      stage,
      ...dates,
      owner: raw.owner?.trim() || '',
      campaign: raw.campaign?.trim() || '',
      contact_name: raw.contact_name?.trim() || '',
      company: raw.company?.trim() || '',
      contact_email: raw.contact_email?.trim() || '',
      contact_phone: raw.contact_phone?.trim() || '',
    },
  };
}

// Key used to recognise the same customer across rows and existing contacts
export const contactKey = (name, company) => `${simplify(name)}|${simplify(company)}`;

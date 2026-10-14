// Reads deal rows out of a screenshot, photo or PDF of the SME's records with AI (services/ai.js:
// Claude, or a local Ollama model).
// The rows come back keyed by our own field names, as text, so they go through exactly the same
// checks (readDealRow) as a typed-up spreadsheet.
import { askAiJson, ReadError } from './ai.js';

export { ReadError };

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const PDF_TYPE = 'application/pdf';

export const EXTRACT_FIELDS = [
  'title',
  'value',
  'stage',
  'created_date',
  'closed_date',
  'expected_close_date',
  'campaign',
  'contact_name',
  'company',
  'contact_email',
  'contact_phone',
  'owner',
];

// Only the fields a record shows are written out: most rows leave email, phone, campaign etc. empty,
// and writing those as "" was most of what the AI had to type (output is what makes reading slow)
const schemaFor = (fields) => ({
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])),
        additionalProperties: false,
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['rows', 'notes'],
  additionalProperties: false,
});

const promptFor = (fields) => `This is a picture or document of a small Kenyan business's sales records (a spreadsheet screenshot, a photo of a ledger or receipt book, an exported report, etc.).
Copy every deal / sale / order row into "rows". One row per deal; skip header, total and blank lines.

Fields (leave a field out when the record doesn't show it; never invent values):
- title: what was sold or the deal name (left out if the record doesn't say)
- value: the amount exactly as written, e.g. "KES 120,000"
- stage: one of lead, qualified, proposal, negotiation, won, lost. Paid / sold / complete means won; cancelled / rejected means lost; quoted means proposal. If the record shows no status at all, leave it out (the user chooses a default). If a status is shown but you can't tell which stage it is, copy it as written.
- created_date, closed_date, expected_close_date: YYYY-MM-DD. Dates in these records are day-first (03/04/2026 is 3 April 2026). closed_date is only for won or lost deals; for a sales book or receipt, the sale date is both created_date and closed_date.
- ${fields.filter((f) => !['title', 'value', 'stage', 'created_date', 'closed_date', 'expected_close_date'].includes(f)).join(', ')}: as written.${fields.includes('owner') ? ' owner is the salesperson.' : ''}

In "notes", briefly list anything a person should double-check, such as cut-off, smudged or unreadable cells (mention the deal title). Leave it empty if everything was clear.
If there are no sales records in it at all, return no rows and say so in notes.`;

// buffer + mime type -> { rows: [{ title, value, ... }], notes: [...] }; fields: which of
// EXTRACT_FIELDS to read (reps can't set the salesperson, so it isn't asked for)
export async function readTableWithAi(buffer, mediaType, fields = EXTRACT_FIELDS) {
  const file = mediaType === PDF_TYPE ? { pdf: buffer } : { image: { data: buffer.toString('base64'), mediaType } };
  // Copying a table needs no deep thinking, so low effort: much quicker, same rows
  const parsed = await askAiJson({ prompt: promptFor(fields), ...file, schema: schemaFor(fields), effort: 'low', maxTokens: 64000 });
  // Small local models sometimes add an "everything is clear" note; only keep real warnings
  const notes = (parsed.notes ?? []).filter((n) => !/no need to|nothing to (double-?)?check|(everything|all .{0,30}) (is|are|was|were|looks?) (clear|fine|present|correct)/i.test(n));
  return { rows: parsed.rows ?? [], notes };
}

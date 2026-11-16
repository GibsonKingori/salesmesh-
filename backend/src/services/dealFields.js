import { mapHeaders } from './dealImport.js';

const FIELD_TYPES = new Set(['text', 'number', 'date', 'boolean']);
const FIELD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_FIELDS = 20;

export function validateDealFields(input) {
  if (!Array.isArray(input) || input.length > MAX_FIELDS) {
    return { error: `fields must be a list of no more than ${MAX_FIELDS} items` };
  }

  const ids = new Set();
  const labels = new Set();
  const fields = [];
  for (const [index, raw] of input.entries()) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    const type = raw?.type;
    const active = raw?.active === undefined ? true : raw.active;

    if (!FIELD_ID.test(id)) return { error: `Field ${index + 1} has an invalid id` };
    if (!label || label.length > 50) return { error: `Field ${index + 1} needs a label of 1 to 50 characters` };
    if (mapHeaders([label])[0]) return { error: `"${label}" matches a standard import column; choose a more specific name` };
    if (!FIELD_TYPES.has(type)) return { error: `Field "${label}" has an unsupported type` };
    if (typeof active !== 'boolean') return { error: `Field "${label}" must be active or hidden` };
    if (ids.has(id)) return { error: `Field id "${id}" is used more than once` };
    const labelKey = label.toLowerCase();
    if (labels.has(labelKey)) return { error: `Field label "${label}" is used more than once` };

    ids.add(id);
    labels.add(labelKey);
    fields.push({ id, label, type, active });
  }
  return { fields };
}

export async function loadDealFields(db, companyId) {
  const { data, error } = await db.from('companies').select('deal_fields').eq('id', companyId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.deal_fields) return [];
  const validated = validateDealFields(data.deal_fields);
  if (validated.error) throw new Error(`Saved deal fields are invalid: ${validated.error}`);
  return validated.fields;
}

export function validateCustomFieldValues(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'custom_fields must be an object' };
  }

  const activeFields = fields.filter((field) => field.active !== false);
  const allowed = new Map(activeFields.map((field) => [field.id, field]));
  const unknown = Object.keys(input).filter((id) => !allowed.has(id));
  if (unknown.length) return { error: `Unknown custom field(s): ${unknown.join(', ')}` };

  const values = {};
  for (const [id, raw] of Object.entries(input)) {
    const field = allowed.get(id);
    if (raw === null || raw === '' || (typeof raw === 'string' && !raw.trim())) {
      values[id] = null;
      continue;
    }

    if (field.type === 'text') {
      if (typeof raw !== 'string') return { error: `"${field.label}" must be text` };
      const value = raw.trim();
      if (value.length > 1000) return { error: `"${field.label}" must be 1,000 characters or fewer` };
      values[id] = value || null;
    } else if (field.type === 'number') {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `"${field.label}" must be a number` };
      const value = typeof raw === 'number' ? raw : Number(raw.trim());
      if (!Number.isFinite(value)) return { error: `"${field.label}" must be a number` };
      values[id] = value;
    } else if (field.type === 'date') {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { error: `"${field.label}" must be a date` };
      }
      const date = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw) {
        return { error: `"${field.label}" must be a real date` };
      }
      values[id] = raw;
    } else {
      if (typeof raw !== 'boolean') return { error: `"${field.label}" must be yes or no` };
      values[id] = raw;
    }
  }
  return { values };
}

export const customFieldMapping = (id) => `custom:${id}`;

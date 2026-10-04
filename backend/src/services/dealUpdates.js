// Validation for PATCH /api/deals/:id. Kept dependency-free (like analytics.js) so it's
// unit-testable without Supabase.

export const VALID_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const EDITABLE_FIELDS = ['title', 'value', 'stage', 'contact_id', 'campaign_id', 'expected_close_date'];
const MANAGER_ONLY_FIELDS = ['owner_id'];

// closed_at records when a deal was won or lost; the forecast and velocity read it.
// Returns the closed_at to save when a deal moves from `previousStage` to `nextStage`,
// or undefined when it shouldn't change (e.g. editing a won deal's title).
export function closedAtForStageChange(previousStage, nextStage, now = new Date()) {
  if (!nextStage || nextStage === previousStage) return undefined;
  return ['won', 'lost'].includes(nextStage) ? now.toISOString() : null;
}

export function canEditDeal(user, deal) {
  return ['manager', 'admin'].includes(user.role) || deal.owner_id === user.id;
}

// Returns { updates } or { error }. Unknown fields are rejected rather than silently
// dropped, so a client bug (or a rep trying to set owner_id) fails loudly.
export function buildDealUpdate(body, user, now = new Date()) {
  const isManager = ['manager', 'admin'].includes(user.role);
  const allowed = isManager ? [...EDITABLE_FIELDS, ...MANAGER_ONLY_FIELDS] : EDITABLE_FIELDS;

  const keys = Object.keys(body || {});
  const disallowed = keys.filter((k) => !allowed.includes(k));
  if (disallowed.length > 0) {
    return { error: `Cannot update field(s): ${disallowed.join(', ')}` };
  }
  if (keys.length === 0) {
    return { error: 'No fields to update' };
  }

  const updates = {};

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return { error: 'title cannot be empty' };
    updates.title = title;
  }

  if ('value' in body) {
    const value = Number(body.value);
    if (body.value === null || body.value === '' || Number.isNaN(value) || value < 0) {
      return { error: 'value must be a non-negative number' };
    }
    updates.value = value;
  }

  if ('stage' in body) {
    const stage = typeof body.stage === 'string' ? body.stage.trim().toLowerCase() : '';
    if (!VALID_STAGES.includes(stage)) {
      return { error: `stage must be one of: ${VALID_STAGES.join(', ')}` };
    }
    updates.stage = stage;
  }

  for (const field of ['contact_id', 'campaign_id', 'expected_close_date', 'owner_id']) {
    if (field in body) updates[field] = body[field] || null;
  }

  updates.updated_at = now.toISOString();

  return { updates };
}

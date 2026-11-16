export const DEFAULT_PIPELINE_STAGES = [
  { id: 'lead', label: 'New', type: 'open' },
  { id: 'qualified', label: 'Under review', type: 'open' },
  { id: 'proposal', label: 'Offer sent', type: 'open' },
  { id: 'negotiation', label: 'Waiting for decision', type: 'open' },
  { id: 'won', label: 'Completed', type: 'won' },
  { id: 'lost', label: 'Not proceeding', type: 'lost' },
];

export async function loadPipelineStages(supabase, companyId) {
  const { data, error } = await supabase.from('companies').select('pipeline_stages').eq('id', companyId).maybeSingle();
  if (error) throw error;
  if (!Array.isArray(data?.pipeline_stages?.stages)) return DEFAULT_PIPELINE_STAGES;
  return data.pipeline_stages.stages.map((stage) =>
    stage.id === 'proposal' && typeof stage.label === 'string' && stage.label.trim().toLowerCase() === 'plan shared'
      ? { ...stage, label: 'Offer sent' }
      : stage
  );
}

export function validatePipelineStages(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return { error: 'Add at least one in-progress stage, plus Won and Lost stages.' };
  }

  const ids = new Set();
  const labels = new Set();
  const stages = [];
  for (const stage of value) {
    if (!stage || typeof stage.id !== 'string' || typeof stage.label !== 'string') {
      return { error: 'Each stage needs an id and a name.' };
    }
    const id = stage.id.trim().toLowerCase();
    const label = stage.label.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id) || !label || label.length > 40) {
      return { error: 'Stage names must be 1–40 characters long.' };
    }
    if (!['open', 'won', 'lost'].includes(stage.type)) {
      return { error: `Invalid type for "${label}". Choose open, won, or lost.` };
    }
    if (ids.has(id) || labels.has(label.toLowerCase())) {
      return { error: 'Stage names must be unique.' };
    }
    ids.add(id);
    labels.add(label.toLowerCase());
    stages.push({ id, label, type: stage.type });
  }

  if (stages.filter((stage) => stage.type === 'open').length < 1 ||
      stages.filter((stage) => stage.type === 'won').length !== 1 ||
      stages.filter((stage) => stage.type === 'lost').length !== 1) {
    return { error: 'Keep at least one in-progress stage and exactly one Won and one Lost stage.' };
  }
  if (stages[stages.length - 2].id !== 'won' || stages[stages.length - 1].id !== 'lost' ||
      stages.some((stage) => stage.type === 'won' && stage.id !== 'won') ||
      stages.some((stage) => stage.type === 'lost' && stage.id !== 'lost')) {
    return { error: 'Keep Won and Lost as the final two stages, in that order.' };
  }
  return { stages };
}

export const stageById = (stages, id) => stages.find((stage) => stage.id === id);
export const isClosedStage = (stages, id) => ['won', 'lost'].includes(stageById(stages, id)?.type);

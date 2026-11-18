import { DEFAULT_PIPELINE_STAGES, loadPipelineStages, validatePipelineStages } from './pipelineStages.js';
import { createFakeSupabase } from '../test/fakeSupabase.js';

describe('loadPipelineStages', () => {
  test('relabels the old default stages without changing IDs or stored settings', async () => {
    const oldLabels = {
      qualified: 'Under review',
      proposal: 'Offer sent',
      negotiation: 'Waiting for decision',
      won: 'Completed',
      lost: 'Not proceeding',
    };
    const savedStages = DEFAULT_PIPELINE_STAGES.map((stage) =>
      oldLabels[stage.id] ? { ...stage, label: oldLabels[stage.id] } : stage
    );
    const supabase = createFakeSupabase({
      companies: [{ id: 'co-1', pipeline_stages: { stages: savedStages } }],
    });

    const stages = await loadPipelineStages(supabase, 'co-1');

    expect(stages).toEqual(DEFAULT_PIPELINE_STAGES);
    expect(supabase.tables.companies[0].pipeline_stages.stages).toEqual(savedStages);
  });

  test('keeps custom labels for the proposal stage', async () => {
    const supabase = createFakeSupabase({
      companies: [{ id: 'co-1', pipeline_stages: { stages: [{ id: 'proposal', label: 'Estimate sent', type: 'open' }] } }],
    });

    const stages = await loadPipelineStages(supabase, 'co-1');

    expect(stages[0].label).toBe('Estimate sent');
  });
});

describe('validatePipelineStages', () => {
  test('accepts custom in-progress stages before the fixed outcome stages', () => {
    const stages = [
      { id: 'intake', label: 'New request', type: 'open' },
      { id: 'scheduled', label: 'Appointment scheduled', type: 'open' },
      { id: 'won', label: 'Completed', type: 'won' },
      { id: 'lost', label: 'Cancelled', type: 'lost' },
    ];
    expect(validatePipelineStages(stages)).toEqual({ stages });
  });

  test('rejects duplicate names and missing outcome stages', () => {
    const duplicate = [...DEFAULT_PIPELINE_STAGES];
    duplicate[1] = { ...duplicate[1], label: duplicate[0].label };
    expect(validatePipelineStages(duplicate).error).toMatch(/unique/);
    expect(validatePipelineStages(DEFAULT_PIPELINE_STAGES.slice(0, -1)).error).toMatch(/one Sale completed and one Cancelled/);
  });

  test('requires Won and Lost to remain the final two stages', () => {
    const invalid = [DEFAULT_PIPELINE_STAGES[0], DEFAULT_PIPELINE_STAGES[4], DEFAULT_PIPELINE_STAGES[1], DEFAULT_PIPELINE_STAGES[5]];
    expect(validatePipelineStages(invalid).error).toMatch(/final two/);
  });
});

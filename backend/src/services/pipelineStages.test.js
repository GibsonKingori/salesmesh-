import { DEFAULT_PIPELINE_STAGES, validatePipelineStages } from './pipelineStages.js';

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
    expect(validatePipelineStages(DEFAULT_PIPELINE_STAGES.slice(0, -1)).error).toMatch(/one Won and one Lost/);
  });

  test('requires Won and Lost to remain the final two stages', () => {
    const invalid = [DEFAULT_PIPELINE_STAGES[0], DEFAULT_PIPELINE_STAGES[4], DEFAULT_PIPELINE_STAGES[1], DEFAULT_PIPELINE_STAGES[5]];
    expect(validatePipelineStages(invalid).error).toMatch(/final two/);
  });
});

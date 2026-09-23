import {
  descriptiveSummary,
  conversionFunnel,
  forecastRevenue,
  campaignCPA,
  campaignROI,
  pipelineVelocity,
  priorityScore,
  rankDealsByPriority,
} from './analytics.js';

const deal = (overrides) => ({
  id: 'd1',
  value: 1000,
  stage: 'lead',
  campaign_id: null,
  expected_close_date: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('descriptiveSummary', () => {
  it('handles an empty pipeline', () => {
    expect(descriptiveSummary([])).toMatchObject({
      totalDeals: 0,
      totalValue: 0,
      avgDealValue: 0,
      openCount: 0,
      wonCount: 0,
      lostCount: 0,
      wonValue: 0,
    });
  });

  it('summarizes a mixed pipeline', () => {
    const deals = [
      deal({ id: 'a', stage: 'lead', value: 100 }),
      deal({ id: 'b', stage: 'won', value: 500 }),
      deal({ id: 'c', stage: 'lost', value: 200 }),
    ];
    const summary = descriptiveSummary(deals);
    expect(summary.totalDeals).toBe(3);
    expect(summary.totalValue).toBe(800);
    expect(summary.wonValue).toBe(500);
    expect(summary.openCount).toBe(1);
  });
});

describe('conversionFunnel', () => {
  it('returns null rates for an empty pipeline', () => {
    const { transitions } = conversionFunnel([]);
    expect(transitions.every((t) => t.actualRate === null)).toBe(true);
    expect(transitions.every((t) => t.underperforming === false)).toBe(true);
  });

  it('flags a transition below benchmark', () => {
    const deals = [deal({ stage: 'lead' }), deal({ stage: 'lead' }), deal({ stage: 'qualified' })];
    const { transitions } = conversionFunnel(deals, { 'lead->qualified': 0.5 });
    const leadToQualified = transitions.find((t) => t.from === 'lead' && t.to === 'qualified');
    // 2 deals reached lead-or-beyond (all 3, since qualified counts too) — reached(lead)=3, reached(qualified)=1
    expect(leadToQualified.actualRate).toBeCloseTo(1 / 3, 2);
    expect(leadToQualified.underperforming).toBe(true); // below the 0.5 benchmark
  });

  it('never flags transitions that have no benchmark set', () => {
    const deals = [deal({ stage: 'lead' }), deal({ stage: 'lead' }), deal({ stage: 'qualified' })];
    const { transitions } = conversionFunnel(deals);
    expect(transitions.every((t) => t.expectedRate === null && !t.underperforming)).toBe(true);
  });
});

describe('pipelineVelocity', () => {
  it('returns 0 for an empty pipeline', () => {
    expect(pipelineVelocity([])).toEqual({ velocity: 0, basis: 'insufficient_closed_deals' });
  });

  it('returns 0 when there are no won deals', () => {
    const deals = [deal({ stage: 'lead' }), deal({ stage: 'lost' })];
    expect(pipelineVelocity(deals).basis).toBe('insufficient_closed_deals');
  });

  it('computes velocity from a known scenario', () => {
    const deals = [
      deal({ id: 'open1', stage: 'qualified' }),
      deal({
        id: 'won1',
        stage: 'won',
        value: 1000,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-11T00:00:00Z', // 10-day cycle
      }),
      deal({ id: 'lost1', stage: 'lost' }),
    ];
    // opportunities=1, avgDealSize=1000, winRate=1/2=0.5, cycle=10 days
    // velocity = (1 * 1000 * 0.5) / 10 = 50
    const result = pipelineVelocity(deals);
    expect(result.velocity).toBe(50);
  });
});

describe('forecastRevenue', () => {
  it('refuses to extrapolate when every win closed on the same day', () => {
    const sameDay = '2026-09-23T10:00:00Z';
    const deals = [1, 2, 3].map((i) => deal({ id: `w${i}`, stage: 'won', value: 100000, updated_at: sameDay }));
    const result = forecastRevenue(deals, [30]);
    expect(result.basis).toBe('insufficient_history');
    expect(result.day30).toBe(0);
  });

  it('returns zero for every horizon with no won deals', () => {
    const result = forecastRevenue([], [30, 60, 90]);
    expect(result.basis).toBe('no_won_deals');
    expect(result.day30).toBe(0);
    expect(result.day60).toBe(0);
    expect(result.day90).toBe(0);
    expect(result.horizons).toEqual([
      { days: 30, value: 0 },
      { days: 60, value: 0 },
      { days: 90, value: 0 },
    ]);
  });

  it('projects forward using a simple linear trend', () => {
    // Two won deals exactly 10 days apart, KES 100 each => 10/day trend
    const deals = [
      deal({ id: 'w1', stage: 'won', value: 100, updated_at: '2026-01-01T00:00:00Z' }),
      deal({ id: 'w2', stage: 'won', value: 200, updated_at: '2026-01-11T00:00:00Z' }),
    ];
    const result = forecastRevenue(deals, [30]);
    expect(result.basis).toBe('linear_trend');
    expect(result.dailyRate).toBeGreaterThan(0);
    expect(result.day30).toBeGreaterThan(0);
  });
});

describe('campaign CPA/ROI', () => {
  const campaign = { id: 'c1', budget: 1000 };

  it('returns null CPA when the campaign generated no deals', () => {
    expect(campaignCPA(campaign, [])).toBeNull();
  });

  it('returns null ROI for a zero-budget campaign', () => {
    expect(campaignROI({ id: 'c1', budget: 0 }, [deal({ campaign_id: 'c1', stage: 'won' })])).toBeNull();
  });

  it('computes CPA and ROI for a normal campaign', () => {
    const deals = [
      deal({ id: 'x', campaign_id: 'c1', stage: 'won', value: 3000 }),
      deal({ id: 'y', campaign_id: 'c1', stage: 'lead', value: 500 }),
    ];
    expect(campaignCPA(campaign, deals)).toBe(500); // 1000 / 2 deals
    expect(campaignROI(campaign, deals)).toBe(200); // (3000 - 1000) / 1000 * 100
  });
});

describe('priorityScore / rankDealsByPriority', () => {
  it('returns an empty ranking for an empty pipeline', () => {
    expect(rankDealsByPriority([])).toEqual([]);
  });

  it('gives a deal with no expected_close_date a neutral urgency score', () => {
    const d = deal({ stage: 'lead', value: 100, expected_close_date: null });
    const score = priorityScore(d, [d]);
    expect(score).toBeGreaterThan(0);
  });

  it('ranks deals closer to closing and further along the pipeline higher', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const deals = [
      deal({ id: 'low', stage: 'lead', value: 100, expected_close_date: '2026-12-01' }),
      deal({ id: 'high', stage: 'negotiation', value: 900, expected_close_date: '2026-06-02' }),
    ];
    const ranked = rankDealsByPriority(deals, now);
    expect(ranked[0].id).toBe('high');
    expect(ranked[0].priority_score).toBeGreaterThan(ranked[1].priority_score);
  });
});

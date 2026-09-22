// Pure calculation functions for SalesMesh's four analytics types (proposal §2.7, §3.8).
// Kept dependency-free (no Supabase/Express) so they're directly unit-testable per §3.6.1.

const OPEN_STAGES = ['lead', 'qualified', 'proposal', 'negotiation'];
const FUNNEL_STAGE_ORDER = ['lead', 'qualified', 'proposal', 'negotiation', 'won'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Default expected conversion rates between adjacent funnel stages.
// Placeholder benchmarks until Iteration 1 SME interviews (proposal §3.3) supply real ones.
const DEFAULT_BENCHMARKS = {
  'lead->qualified': 0.5,
  'qualified->proposal': 0.6,
  'proposal->negotiation': 0.5,
  'negotiation->won': 0.4,
};

const sum = (nums) => nums.reduce((a, b) => a + b, 0);
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// --- Descriptive: what happened ---
export function descriptiveSummary(deals) {
  const totalDeals = deals.length;
  const totalValue = sum(deals.map((d) => Number(d.value) || 0));
  const wonDeals = deals.filter((d) => d.stage === 'won');
  const lostDeals = deals.filter((d) => d.stage === 'lost');
  const openDeals = deals.filter((d) => !['won', 'lost'].includes(d.stage));

  const byStage = FUNNEL_STAGE_ORDER.concat('lost').reduce((acc, stage) => {
    const stageDeals = deals.filter((d) => d.stage === stage);
    acc[stage] = { count: stageDeals.length, value: round2(sum(stageDeals.map((d) => Number(d.value) || 0))) };
    return acc;
  }, {});

  return {
    totalDeals,
    totalValue: round2(totalValue),
    avgDealValue: totalDeals ? round2(totalValue / totalDeals) : 0,
    openCount: openDeals.length,
    wonCount: wonDeals.length,
    lostCount: lostDeals.length,
    wonValue: round2(sum(wonDeals.map((d) => Number(d.value) || 0))),
    byStage,
  };
}

// --- Diagnostic: why. Cross-sectional funnel — "reached(stage)" counts deals currently
// at or beyond that stage. Lost deals are excluded (we don't track the stage they were
// lost at), so this undercounts true historical drop-off; a real cohort funnel needs
// stage-change history, which Iteration 1's schema doesn't yet capture. ---
export function conversionFunnel(deals, benchmarks = DEFAULT_BENCHMARKS) {
  const reached = (stageIdx) =>
    deals.filter((d) => FUNNEL_STAGE_ORDER.indexOf(d.stage) >= stageIdx).length;

  const stages = FUNNEL_STAGE_ORDER.map((stage, idx) => ({ stage, reached: reached(idx) }));

  const transitions = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    const key = `${from.stage}->${to.stage}`;
    const actualRate = from.reached > 0 ? to.reached / from.reached : null;
    const expectedRate = benchmarks[key] ?? null;
    transitions.push({
      from: from.stage,
      to: to.stage,
      actualRate: actualRate === null ? null : round2(actualRate),
      expectedRate,
      underperforming: actualRate !== null && expectedRate !== null && actualRate < expectedRate,
    });
  }

  return { stages, transitions };
}

// --- Predictive: trend-based 30/60/90-day forecast, no ML per proposal §1.6 scope note.
// Fits a least-squares line through cumulative won-deal revenue over time, then
// projects the resulting daily rate forward. updated_at is used as a proxy for
// "date the deal closed" since the schema has no dedicated closed_at column. ---
export function forecastRevenue(deals, horizonDaysList = [30, 60, 90], now = new Date()) {
  const wonDeals = deals.filter((d) => d.stage === 'won' && d.updated_at);

  if (wonDeals.length === 0) {
    return { basis: 'no_won_deals', dailyRate: 0, ...zeroHorizons(horizonDaysList) };
  }

  const points = wonDeals
    .map((d) => ({ t: new Date(d.updated_at).getTime(), v: Number(d.value) || 0 }))
    .sort((a, b) => a.t - b.t);

  const t0 = points[0].t;
  let cumulative = 0;
  const series = points.map((p) => {
    cumulative += p.v;
    return { x: (p.t - t0) / DAY_MS, y: cumulative };
  });

  let dailyRate;
  if (series.length === 1) {
    dailyRate = series[0].x > 0 ? series[0].y / series[0].x : 0;
  } else {
    const n = series.length;
    const sumX = sum(series.map((p) => p.x));
    const sumY = sum(series.map((p) => p.y));
    const sumXY = sum(series.map((p) => p.x * p.y));
    const sumXX = sum(series.map((p) => p.x * p.x));
    const denom = n * sumXX - sumX * sumX;
    dailyRate = denom === 0 ? sumY / n : (n * sumXY - sumX * sumY) / denom;
  }
  dailyRate = Math.max(dailyRate, 0);

  const result = { basis: 'linear_trend', dailyRate: round2(dailyRate) };
  horizonDaysList.forEach((h) => {
    result[`day${h}`] = round2(dailyRate * h);
  });
  return result;
}

function zeroHorizons(horizonDaysList) {
  return horizonDaysList.reduce((acc, h) => ({ ...acc, [`day${h}`]: 0 }), {});
}

// --- Campaign analytics: CPA and ROI ---
export function campaignCPA(campaign, deals) {
  const campaignDeals = deals.filter((d) => d.campaign_id === campaign.id);
  if (campaignDeals.length === 0) return null;
  return round2((Number(campaign.budget) || 0) / campaignDeals.length);
}

export function campaignROI(campaign, deals) {
  const budget = Number(campaign.budget) || 0;
  if (budget === 0) return null; // zero-budget campaign: ROI is undefined, not infinite
  const campaignDeals = deals.filter((d) => d.campaign_id === campaign.id);
  const revenue = sum(campaignDeals.filter((d) => d.stage === 'won').map((d) => Number(d.value) || 0));
  return round2(((revenue - budget) / budget) * 100);
}

// --- Pipeline velocity: (opportunities x avg deal size x win rate) / avg sales cycle length,
// per proposal §2.2.2. Basis choices: opportunities = currently-open deal count;
// avg deal size / cycle length drawn from WON deals only (the only deals with a real cycle length). ---
export function pipelineVelocity(deals) {
  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const wonDeals = deals.filter((d) => d.stage === 'won');
  const lostDeals = deals.filter((d) => d.stage === 'lost');
  const closedCount = wonDeals.length + lostDeals.length;

  if (wonDeals.length === 0 || closedCount === 0) {
    return { velocity: 0, basis: 'insufficient_closed_deals' };
  }

  const opportunities = openDeals.length;
  const avgDealSize = sum(wonDeals.map((d) => Number(d.value) || 0)) / wonDeals.length;
  const winRate = wonDeals.length / closedCount;
  const cycleLengths = wonDeals.map(
    (d) => (new Date(d.updated_at).getTime() - new Date(d.created_at).getTime()) / DAY_MS
  );
  const avgSalesCycleLength = sum(cycleLengths) / cycleLengths.length;

  if (avgSalesCycleLength <= 0) {
    return { velocity: 0, basis: 'zero_cycle_length' };
  }

  return {
    velocity: round2((opportunities * avgDealSize * winRate) / avgSalesCycleLength),
    opportunities,
    avgDealSize: round2(avgDealSize),
    winRate: round2(winRate),
    avgSalesCycleLength: round2(avgSalesCycleLength),
  };
}

// --- Prescriptive: deal priority score from stage position, close-date urgency, and
// relative deal value (proposal §2.7). Weights (0.4/0.35/0.25) are a first-pass judgment
// call, not derived from user research — a documented candidate for Iteration 2/3 tuning. ---
export function priorityScore(deal, openDeals, now = new Date()) {
  const stageIdx = OPEN_STAGES.indexOf(deal.stage);
  const stageScore = stageIdx === -1 ? 0 : stageIdx / (OPEN_STAGES.length - 1);

  let urgencyScore = 0.5;
  if (deal.expected_close_date) {
    const daysUntilClose = (new Date(deal.expected_close_date).getTime() - now.getTime()) / DAY_MS;
    urgencyScore = clamp(1 - daysUntilClose / 90, 0, 1);
  }

  const maxValue = Math.max(0, ...openDeals.map((d) => Number(d.value) || 0));
  const valueScore = maxValue > 0 ? (Number(deal.value) || 0) / maxValue : 0;

  const score = stageScore * 0.4 + urgencyScore * 0.35 + valueScore * 0.25;
  return round2(score * 100);
}

export function rankDealsByPriority(deals, now = new Date()) {
  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  return openDeals
    .map((d) => ({ ...d, priority_score: priorityScore(d, openDeals, now) }))
    .sort((a, b) => b.priority_score - a.priority_score);
}

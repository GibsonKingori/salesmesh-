// Pure calculation functions for SalesMesh's four analytics types (proposal §2.7, §3.8).
// Kept dependency-free (no Supabase/Express) so they're directly unit-testable per §3.6.1.

import { DEFAULT_PIPELINE_STAGES } from './pipelineStages.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const FUNNEL_TRANSITIONS = (stages = DEFAULT_PIPELINE_STAGES) => {
  const funnel = stages.filter((stage) => stage.type !== 'lost');
  return funnel.slice(0, -1).map((stage, idx) => `${stage.id}->${funnel[idx + 1].id}`);
};
export const DEFAULT_FORECAST_HORIZONS = [30, 60, 90];

const sum = (nums) => nums.reduce((a, b) => a + b, 0);
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// --- Descriptive: what happened ---
const stageType = (stages, id) => stages.find((stage) => stage.id === id)?.type || 'open';

export function descriptiveSummary(deals, stages = DEFAULT_PIPELINE_STAGES) {
  const totalDeals = deals.length;
  const totalValue = sum(deals.map((d) => Number(d.value) || 0));
  const wonDeals = deals.filter((d) => stageType(stages, d.stage) === 'won');
  const lostDeals = deals.filter((d) => stageType(stages, d.stage) === 'lost');
  const openDeals = deals.filter((d) => stageType(stages, d.stage) === 'open');

  const byStage = stages.reduce((acc, stage) => {
    const stageDeals = deals.filter((d) => d.stage === stage.id);
    acc[stage.id] = { count: stageDeals.length, value: round2(sum(stageDeals.map((d) => Number(d.value) || 0))) };
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
    stages,
  };
}

// --- Diagnostic: why. Cross-sectional funnel — "reached(stage)" counts deals currently
// at or beyond that stage. Lost deals are excluded (we don't track the stage they were
// lost at), so this undercounts true historical drop-off; a real cohort funnel needs
// stage-change history, which Iteration 1's schema doesn't yet capture. ---
// benchmarks: { 'lead->qualified': 0.5, ... }; transitions without one are never flagged.
export function conversionFunnel(deals, benchmarks = {}, pipeline = DEFAULT_PIPELINE_STAGES) {
  const stages = pipeline.map((stage, idx, funnel) => ({
    stage: stage.id,
    label: stage.label,
    id: stage.id,
    type: stage.type,
    count: deals.filter((deal) => deal.stage === stage.id).length,
    reached: stage.type === 'lost' ? 0 : deals.filter((d) => funnel.findIndex((item) => item.id === d.stage) >= idx && stageType(pipeline, d.stage) !== 'lost').length,
  }));

  const transitions = [];
  const funnelStages = stages.filter((stage) => stage.type !== 'lost');
  for (let i = 0; i < funnelStages.length - 1; i++) {
    const from = funnelStages[i];
    const to = funnelStages[i + 1];
    const key = `${from.id}->${to.id}`;
    const actualRate = from.reached > 0 ? to.reached / from.reached : null;
    const expectedRate = benchmarks[key] ?? null;
    transitions.push({
      from: from.stage,
      to: to.stage,
      fromLabel: from.label,
      toLabel: to.label,
      transition: `${from.id}->${to.id}`,
      actualRate: actualRate === null ? null : round2(actualRate),
      expectedRate,
      underperforming: actualRate !== null && expectedRate !== null && actualRate < expectedRate,
    });
  }

  return { stages, transitions };
}

// When a won/lost deal closed
export const closedAt = (deal) => deal.closed_at || deal.updated_at;

// --- Predictive: trend-based 30/60/90-day forecast, no ML per proposal §1.6 scope note.
// Fits a least-squares line through cumulative won-deal revenue over time, then
// projects the resulting daily rate forward. Uses closed_at (set when a deal is won/lost,
// or imported from the SME's records); older rows without it fall back to updated_at. ---
export function forecastRevenue(deals, horizonDaysList = DEFAULT_FORECAST_HORIZONS, now = new Date()) {
  const wonDeals = deals.filter((d) => d.stage === 'won' && closedAt(d));

  if (wonDeals.length === 0) {
    return withHorizonList({ basis: 'no_won_deals', dailyRate: 0, ...zeroHorizons(horizonDaysList) }, horizonDaysList);
  }

  const points = wonDeals
    .map((d) => ({ t: new Date(closedAt(d)).getTime(), v: Number(d.value) || 0 }))
    .sort((a, b) => a.t - b.t);

  const t0 = points[0].t;
  // All wins on the same day (e.g. straight after a CSV import) give no time axis to fit a
  // trend to — the regression would divide by ~zero and report a huge daily rate
  if (points[points.length - 1].t - t0 < DAY_MS) {
    return withHorizonList({ basis: 'insufficient_history', dailyRate: 0, ...zeroHorizons(horizonDaysList) }, horizonDaysList);
  }

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
  return withHorizonList(result, horizonDaysList);
}

// Also expose horizons as a list so the UI renders whatever the API chose, not its own [30, 60, 90]
function withHorizonList(result, horizonDaysList) {
  return { ...result, horizons: horizonDaysList.map((days) => ({ days, value: result[`day${days}`] })) };
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
export function pipelineVelocity(deals, stages = DEFAULT_PIPELINE_STAGES) {
  const openDeals = deals.filter((d) => stageType(stages, d.stage) === 'open');
  const wonDeals = deals.filter((d) => stageType(stages, d.stage) === 'won');
  const lostDeals = deals.filter((d) => stageType(stages, d.stage) === 'lost');
  const closedCount = wonDeals.length + lostDeals.length;

  if (wonDeals.length === 0 || closedCount === 0) {
    return { velocity: 0, basis: 'insufficient_closed_deals' };
  }

  const opportunities = openDeals.length;
  const avgDealSize = sum(wonDeals.map((d) => Number(d.value) || 0)) / wonDeals.length;
  const winRate = wonDeals.length / closedCount;
  const cycleLengths = wonDeals.map(
    (d) => (new Date(closedAt(d)).getTime() - new Date(d.created_at).getTime()) / DAY_MS
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
export function priorityScore(deal, openDeals, now = new Date(), stages = DEFAULT_PIPELINE_STAGES) {
  const openStages = stages.filter((stage) => stage.type === 'open');
  const stageIdx = openStages.findIndex((stage) => stage.id === deal.stage);
  const stageScore = stageIdx === -1 ? 0 : stageIdx / Math.max(openStages.length - 1, 1);

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

// --- Team performance (manager dashboard): one row per representative, best won value first.
// Managers and admins only appear if they own deals themselves. ---
export function teamPerformance(deals, users, stages = DEFAULT_PIPELINE_STAGES) {
  return users
    .map((u) => {
      const own = deals.filter((d) => d.owner_id === u.id);
      const open = own.filter((d) => stageType(stages, d.stage) === 'open');
      const won = own.filter((d) => stageType(stages, d.stage) === 'won');
      const closedCount = won.length + own.filter((d) => stageType(stages, d.stage) === 'lost').length;
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        totalDeals: own.length,
        openCount: open.length,
        openValue: round2(sum(open.map((d) => Number(d.value) || 0))),
        wonCount: won.length,
        wonValue: round2(sum(won.map((d) => Number(d.value) || 0))),
        winRate: closedCount ? round2(won.length / closedCount) : null,
      };
    })
    .filter((row) => row.role === 'representative' || row.totalDeals > 0)
    .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);
}

// --- Rep dashboard: open deals past their expected close date, and those due within soonDays ---
export function dealsNeedingAttention(deals, now = new Date(), soonDays = 14, stages = DEFAULT_PIPELINE_STAGES) {
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + soonDays * DAY_MS).toISOString().slice(0, 10);
  const dated = deals
    .filter((d) => stageType(stages, d.stage) === 'open' && d.expected_close_date)
    .sort((a, b) => a.expected_close_date.localeCompare(b.expected_close_date));
  return {
    overdue: dated.filter((d) => d.expected_close_date < today),
    closingSoon: dated.filter((d) => d.expected_close_date >= today && d.expected_close_date <= soon),
    soonDays,
  };
}

export function rankDealsByPriority(deals, now = new Date(), stages = DEFAULT_PIPELINE_STAGES) {
  const openDeals = deals.filter((d) => stageType(stages, d.stage) === 'open');
  return openDeals
    .map((d) => ({ ...d, priority_score: priorityScore(d, openDeals, now, stages) }))
    .sort((a, b) => b.priority_score - a.priority_score);
}

import { buildDealUpdate, canEditDeal } from './dealUpdates.js';

const rep = { id: 'rep-1', role: 'representative', company_id: 'co-1' };
const manager = { id: 'mgr-1', role: 'manager', company_id: 'co-1', teamIds: ['rep-2'] };
const admin = { id: 'admin-1', role: 'admin', company_id: 'co-1' };
const now = new Date('2026-09-23T10:00:00Z');

describe('canEditDeal', () => {
  const deal = (owner_id, company_id = 'co-1') => ({ owner_id, company_id });

  test('rep can edit own deal', () => {
    expect(canEditDeal(rep, deal('rep-1'))).toBe(true);
  });

  test("rep cannot edit another rep's deal", () => {
    expect(canEditDeal(rep, deal('rep-2'))).toBe(false);
  });

  test("manager can edit their own and their reps' deals, but not another team's", () => {
    expect(canEditDeal(manager, deal('mgr-1'))).toBe(true);
    expect(canEditDeal(manager, deal('rep-2'))).toBe(true);
    expect(canEditDeal(manager, deal('rep-1'))).toBe(false);
  });

  test('admin can edit any deal in their company', () => {
    expect(canEditDeal(admin, deal('rep-1'))).toBe(true);
    expect(canEditDeal(admin, deal(null))).toBe(true);
  });

  test('nobody can edit a deal in another company, even with the same owner id', () => {
    expect(canEditDeal(rep, deal('rep-1', 'co-2'))).toBe(false);
    expect(canEditDeal(manager, deal('rep-2', 'co-2'))).toBe(false);
    expect(canEditDeal(admin, deal('rep-1', 'co-2'))).toBe(false);
  });
});

describe('buildDealUpdate', () => {
  test('accepts a stage move and stamps updated_at', () => {
    expect(buildDealUpdate({ stage: 'Won' }, rep, now)).toEqual({
      updates: { stage: 'won', updated_at: '2026-09-23T10:00:00.000Z' },
    });
  });

  test('rejects an invalid stage', () => {
    expect(buildDealUpdate({ stage: 'closed' }, rep, now).error).toMatch(/stage must be one of/);
  });

  test('rep cannot reassign owner_id', () => {
    expect(buildDealUpdate({ owner_id: 'rep-2' }, rep, now).error).toMatch(/owner_id/);
  });

  test('manager can reassign owner_id', () => {
    expect(buildDealUpdate({ owner_id: 'rep-2' }, manager, now).updates.owner_id).toBe('rep-2');
  });

  test('rejects fields outside the allowlist', () => {
    expect(buildDealUpdate({ priority_score: 99, id: 'x' }, manager, now).error).toMatch(
      /priority_score, id/
    );
  });

  test('rejects an empty body', () => {
    expect(buildDealUpdate({}, rep, now).error).toBe('No fields to update');
  });

  test('rejects negative or non-numeric value', () => {
    expect(buildDealUpdate({ value: -5 }, rep, now).error).toMatch(/non-negative/);
    expect(buildDealUpdate({ value: 'abc' }, rep, now).error).toMatch(/non-negative/);
  });

  test('rejects blank title', () => {
    expect(buildDealUpdate({ title: '   ' }, rep, now).error).toMatch(/title/);
  });

  test('empty optional fields become null', () => {
    expect(buildDealUpdate({ expected_close_date: '', contact_id: '' }, rep, now).updates).toMatchObject({
      expected_close_date: null,
      contact_id: null,
    });
  });
});

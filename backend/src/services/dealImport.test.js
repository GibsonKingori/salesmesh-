import { mapHeaders, parseDate, parseMoney, parseStage, readDealRow } from './dealImport.js';
import { closedAtForStageChange } from './dealUpdates.js';
import { forecastRevenue, pipelineVelocity } from './analytics.js';

const TODAY = '2026-10-04';

describe('mapHeaders', () => {
  test('recognises common spreadsheet headings', () => {
    expect(mapHeaders(['Deal Name', 'Amount (KES)', 'Status', 'Date Won', 'Customer', 'Company', 'Phone', 'Notes'])).toEqual([
      'title',
      'value',
      'stage',
      'closed_date',
      'contact_name',
      'company',
      'contact_phone',
      null,
    ]);
  });

  test('uses the first column when two headings mean the same thing', () => {
    expect(mapHeaders(['title', 'deal name'])).toEqual(['title', null]);
  });
});

describe('parseMoney', () => {
  test.each([
    ['450000', 450000],
    ['KES 1,250,000.50', 1250000.5],
    ['Ksh 500', 500],
    ['1 200', 1200],
  ])('%s -> %d', (raw, expected) => expect(parseMoney(raw)).toBe(expected));

  test.each(['', 'about 5k', '12-500', undefined])('rejects %s', (raw) => expect(parseMoney(raw)).toBeNaN());
});

describe('parseDate', () => {
  test('reads ISO and Kenyan day-first dates', () => {
    expect(parseDate('2026-03-14')).toBe('2026-03-14');
    expect(parseDate('14/03/2026')).toBe('2026-03-14');
    expect(parseDate('4/3/26')).toBe('2026-03-04');
    expect(parseDate('14.03.2026')).toBe('2026-03-14');
    expect(parseDate('')).toBe('');
  });

  test('rejects dates that do not exist or are month-first', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('03/14/2026')).toBeNull();
    expect(parseDate('March 14')).toBeNull();
  });
});

describe('parseStage', () => {
  test('maps CRM and everyday wording', () => {
    expect(parseStage('Closed Won')).toBe('won');
    expect(parseStage('quote sent')).toBe('proposal');
    expect(parseStage('Cancelled')).toBe('lost');
    expect(parseStage('maybe')).toBeNull();
  });
});

describe('readDealRow', () => {
  const base = { title: 'Order', value: '1000', stage: 'won', created_date: '01/03/2026', closed_date: '15/03/2026' };

  test('accepts a complete row', () => {
    expect(readDealRow(base, TODAY).row).toMatchObject({ stage: 'won', value: 1000, created_date: '2026-03-01', closed_date: '2026-03-15' });
  });

  test.each([
    [{ closed_date: '01/02/2026' }, 'before created'],
    [{ closed_date: '01/12/2026' }, 'future'],
    [{ stage: 'proposal' }, 'only won or lost'],
    [{ value: 'lots' }, 'Invalid value'],
    [{ created_date: '30/02/2026' }, 'Invalid created date'],
  ])('rejects %o', (change, message) => {
    expect(readDealRow({ ...base, ...change }, TODAY).error).toMatch(message);
  });

  test('a single "close date" column is the actual date for won deals and the expected date for open ones', () => {
    expect(readDealRow({ title: 'A', value: '1', stage: 'won', close_date: '10/03/2026' }, TODAY).row.closed_date).toBe('2026-03-10');
    const open = readDealRow({ title: 'B', value: '1', stage: 'lead', close_date: '10/12/2026' }, TODAY).row;
    expect(open).toMatchObject({ expected_close_date: '2026-12-10', closed_date: '' });
  });
});

describe('closedAtForStageChange', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  test('stamps the close date when a deal is won or lost, and clears it when reopened', () => {
    expect(closedAtForStageChange('negotiation', 'won', now)).toBe(now.toISOString());
    expect(closedAtForStageChange('won', 'proposal', now)).toBeNull();
    expect(closedAtForStageChange('won', 'won', now)).toBeUndefined();
    expect(closedAtForStageChange('won', undefined, now)).toBeUndefined();
  });
});

describe('analytics use closed_at, not the last edit', () => {
  test('editing a won deal later does not change its sales cycle', () => {
    const deal = {
      stage: 'won',
      value: 1000,
      created_at: '2026-03-01T09:00:00Z',
      closed_at: '2026-03-11T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z', // title fixed months later
    };
    const open = { stage: 'lead', value: 500, created_at: '2026-09-01T09:00:00Z' };
    expect(pipelineVelocity([deal, open]).avgSalesCycleLength).toBe(10);
  });

  test('imported history spread over several days gives a trend-based forecast', () => {
    const won = (day, value) => ({ stage: 'won', value, created_at: `2026-0${day < 10 ? 1 : 2}-01T00:00:00Z`, closed_at: `2026-03-${String(day).padStart(2, '0')}T12:00:00Z` });
    const result = forecastRevenue([won(1, 1000), won(10, 2000), won(20, 3000)], [30], new Date('2026-03-25T00:00:00Z'));
    expect(result.basis).not.toBe('insufficient_history');
    expect(result.dailyRate).toBeGreaterThan(0);
  });
});

import { parseDealQuery, matchesDealFilters, likePattern } from './dealFilters.js';

describe('likePattern', () => {
  test('wraps the search in wildcards', () => {
    expect(likePattern('acme')).toBe('%acme%');
  });

  test('escapes % and _ so they match literally', () => {
    expect(likePattern('100%_off')).toBe(String.raw`%100\%\_off%`);
  });

  test('turns * into a single-character wildcard, never a run of characters', () => {
    expect(likePattern('a*b')).toBe('%a_b%');
  });
});

const manager = { id: 'mgr-1', role: 'manager' };
const rep = { id: 'rep-1', role: 'representative' };

describe('parseDealQuery', () => {
  test('no options means no filters and no paging', () => {
    expect(parseDealQuery({}, manager)).toEqual({ filters: {}, page: null });
  });

  test('trims the search and ignores a blank one', () => {
    expect(parseDealQuery({ q: '  acme ' }, manager).filters).toEqual({ q: 'acme' });
    expect(parseDealQuery({ q: '   ' }, manager).filters).toEqual({});
  });

  test('owner filter is ignored for reps', () => {
    expect(parseDealQuery({ owner_id: 'rep-2' }, manager).filters).toEqual({ owner_id: 'rep-2' });
    expect(parseDealQuery({ owner_id: 'rep-2' }, rep).filters).toEqual({});
  });

  test('paging defaults to 25 from the start', () => {
    expect(parseDealQuery({ offset: '0' }, manager).page).toEqual({ limit: 25, offset: 0 });
    expect(parseDealQuery({ limit: '10', offset: '20' }, manager).page).toEqual({ limit: 10, offset: 20 });
  });

  test.each([
    [{ status: 'pending' }, /status/],
    [{ limit: '0' }, /limit/],
    [{ limit: '101' }, /limit/],
    [{ limit: 'ten' }, /limit/],
    [{ offset: '-1' }, /offset/],
  ])('rejects %j', (query, message) => {
    expect(parseDealQuery(query, manager).error).toMatch(message);
  });
});

describe('matchesDealFilters', () => {
  const deal = { title: 'Acme Annual', stage: 'proposal', owner_id: 'rep-1', campaign_id: 'cmp-1' };

  test('search is case-insensitive and matches part of the title', () => {
    expect(matchesDealFilters(deal, { q: 'acme ann' })).toBe(true);
    expect(matchesDealFilters(deal, { q: 'globex' })).toBe(false);
  });

  test('status, owner and campaign must all match', () => {
    expect(matchesDealFilters(deal, { status: 'open', owner_id: 'rep-1', campaign_id: 'cmp-1' })).toBe(true);
    expect(matchesDealFilters(deal, { status: 'closed' })).toBe(false);
    expect(matchesDealFilters(deal, { owner_id: 'rep-2' })).toBe(false);
    expect(matchesDealFilters(deal, { campaign_id: 'cmp-2' })).toBe(false);
  });
});

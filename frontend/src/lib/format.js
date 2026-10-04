export const currency = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n || 0);

const compactFormat = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  notation: 'compact',
  maximumFractionDigits: 2,
});

// For small boxes (stat cards, forecast tiles): Ksh 1.29B / Ksh 125.67M from a million up,
// exact below that. Pair it with currency() in a tooltip so the full figure is one hover away.
export const currencyShort = (n) => (Math.abs(n || 0) >= 1_000_000 ? compactFormat.format(n) : currency(n));

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-KE', { dateStyle: 'medium' }) : '—');

export const percent = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

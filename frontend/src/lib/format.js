export const currency = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n || 0);

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-KE', { dateStyle: 'medium' }) : '—');

export const percent = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

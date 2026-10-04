// Plain-English wording for audit log actions recorded by backend/src/services/audit.js
export const AUDIT_CATEGORIES = [
  { value: '', label: 'All activity' },
  { value: 'auth', label: 'Sign-ins & passwords' },
  { value: 'user', label: 'Accounts' },
  { value: 'deal', label: 'Deals' },
  { value: 'contact', label: 'Contacts' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'settings', label: 'Configuration' },
];

export const ROLE_NAMES = { representative: 'Sales Representative', manager: 'Manager', admin: 'Admin' };

const forUser = (d) => (d.forUser ? ` for ${d.forUser}` : '');

export function describeAudit(entry) {
  const d = entry.details || {};
  switch (entry.action) {
    case 'auth.login':
      return 'Logged in';
    case 'auth.logout':
      return 'Logged out';
    case 'auth.login_failed':
      return `Failed login attempt${d.email ? ` for ${d.email}` : ''}`;
    case 'auth.login_blocked':
      return 'Tried to log in to a disabled account';
    case 'auth.register':
      return `Registered as ${ROLE_NAMES[d.role] || 'Sales Representative'}`;
    case 'auth.password_reset_requested':
      return d.matched === false ? `Password reset requested for unknown email ${d.email}` : 'Requested a password reset';
    case 'auth.password_reset':
      return d.viaAdminLink ? 'Changed their password using a link from an admin' : 'Reset their password';
    case 'user.role_change':
      return `Changed ${d.name || 'a user'} from ${ROLE_NAMES[d.from] || d.from || '?'} to ${ROLE_NAMES[d.to] || d.to}`;
    case 'user.disable':
      return `Disabled ${d.name || 'an account'}`;
    case 'user.enable':
      return `Enabled ${d.name || 'an account'}`;
    case 'user.reset_link':
      return `Created a password reset link for ${d.name || 'a user'}`;
    case 'deal.create':
      return `Created deal “${d.title}”${forUser(d)}`;
    case 'deal.update':
      return `Updated deal “${d.title}”${d.changes?.length ? ` (${d.changes.join(', ')})` : ''}`;
    case 'deal.delete':
      return d.title ? `Deleted deal “${d.title}”` : 'Deleted a deal';
    case 'deal.import':
      return `Imported ${d.imported} deal${d.imported === 1 ? '' : 's'} from CSV${d.skipped ? `, ${d.skipped} skipped` : ''}`;
    case 'contact.create':
      return `Added contact “${d.name}”`;
    case 'contact.update':
      return `Updated contact “${d.name}”`;
    case 'contact.delete':
      return 'Deleted a contact';
    case 'campaign.create':
      return `Created campaign “${d.name}”${forUser(d)}`;
    case 'campaign.delete':
      return `Deleted campaign “${d.name}”${d.unlinkedDeals ? ` (${d.unlinkedDeals} deal${d.unlinkedDeals === 1 ? '' : 's'} unlinked)` : ''}`;
    case 'settings.benchmarks_update':
      return 'Updated conversion targets';
    default:
      return entry.action;
  }
}

// Security-relevant entries stand out in the list
const SENSITIVE = new Set([
  'auth.login_failed',
  'auth.login_blocked',
  'auth.password_reset',
  'user.role_change',
  'user.disable',
  'user.enable',
  'user.reset_link',
]);
export const isSensitive = (entry) => SENSITIVE.has(entry.action);

export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

// "2026-10-04" (from a date input) -> the start and end of that day in the viewer's time zone
export function dayRange(dateString, days = 1) {
  const [y, m, d] = dateString.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + days);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Local yyyy-mm-dd for a Date, for date inputs
export const toDateInput = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

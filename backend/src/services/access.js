// Who can see which records. Every company's data is invisible to every other company;
// inside a company:
//   admin           — everything in the company
//   manager         — their own records and those of the representatives assigned to them
//   representative  — only their own records
// req.user carries company_id and, for managers, teamIds (set by middleware/auth.js).
// Kept free of Supabase calls so the rules are unit-testable.

// Owner ids whose records the user may see, or null for "anyone in the company" (admins)
export function visibleOwnerIds(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'manager') return [user.id, ...(user.teamIds || [])];
  return [user.id];
}

// Narrows a supabase query on an owned table (deals, contacts) to what the user may see
export function scopeOwned(query, user, ownerColumn = 'owner_id') {
  const scoped = query.eq('company_id', user.company_id);
  const owners = visibleOwnerIds(user);
  return owners ? scoped.in(ownerColumn, owners) : scoped;
}

// The same rule for a row already loaded (needs its company_id and owner_id)
export function canAccessOwned(user, row, ownerColumn = 'owner_id') {
  if (!row || row.company_id !== user.company_id) return false;
  const owners = visibleOwnerIds(user);
  return !owners || owners.includes(row[ownerColumn]);
}

// Narrows a query on a company-wide table (campaigns, users, audit_logs, funnel_benchmarks)
export const scopeCompany = (query, user) => query.eq('company_id', user.company_id);

export const sameCompany = (user, row) => Boolean(row) && row.company_id === user.company_id;

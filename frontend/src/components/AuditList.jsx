import React from 'react';
import { Link } from 'react-router-dom';
import { describeAudit, formatDateTime, isSensitive } from '../lib/audit.js';

// One line per audit entry: who, what, when. Shared by the admin Overview and Audit Log pages.
export default function AuditList({ entries }) {
  if (entries.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted">No activity recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-fg/5">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3">
          <div className="min-w-0">
            <p className={`text-sm ${isSensitive(e) ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-fg'}`}>
              {describeAudit(e)}
            </p>
            <p className="mt-0.5 text-xs text-subtle">
              {e.user_id ? (
                <Link to={`/admin/accounts/${e.user_id}`} className="hover:text-brand-700 hover:underline dark:hover:text-brand-300">
                  {e.user_name || 'Unknown user'}
                </Link>
              ) : (
                e.user_name || 'Not signed in'
              )}
            </p>
          </div>
          <time dateTime={e.created_at} className="whitespace-nowrap text-xs tabular-nums text-subtle">
            {formatDateTime(e.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}

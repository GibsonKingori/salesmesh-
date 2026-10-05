import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import ConversionTargetsForm from '../../components/ConversionTargetsForm.jsx';
import Panel from '../../components/Panel.jsx';

const mirrorText = (m) => {
  if (!m || m === 'disabled') return 'Off';
  if (m.lastError) return `Error: ${m.lastError}`;
  return m.inSync ? 'In sync' : 'Syncing…';
};

export default function ConfigurationPage() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/admin/config')
      .then((res) => setConfig(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load system settings'));
  }, []);

  const rows = config && [
    ['Environment', config.environment],
    ['Session length', config.sessionLength],
    ['Minimum password length', `${config.minPasswordLength} characters`],
    ['Login rate limit', config.loginRateLimit],
    ['Password reset links last', `${config.passwordResetMinutes} minutes, single use`],
    ['Sign-up', 'Join code from the Overview page (new members join as Sales Reps)'],
    ['Local PostgreSQL copy', mirrorText(config.postgresMirror)],
  ];

  return (
    <DashboardShell title="System configuration">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ConversionTargetsForm />

        <Panel title="System settings" subtitle="Set in backend/.env. Restart the API after changing them.">
          {error && <p className="px-5 py-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
          {!config && !error && <p className="px-5 py-10 text-center text-sm text-muted">Loading…</p>}
          {rows && (
            <dl className="divide-y divide-fg/5">
              {rows.map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <dt className="text-fg-soft">{label}</dt>
                  <dd className="font-medium text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}

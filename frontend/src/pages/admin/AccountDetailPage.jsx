import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import Panel from '../../components/Panel.jsx';
import Modal from '../../components/Modal.jsx';
import StatCard from '../../components/StatCard.jsx';
import StageBadge from '../../components/StageBadge.jsx';
import AuditList from '../../components/AuditList.jsx';
import ConfirmButton from '../../components/ConfirmButton.jsx';
import { CHANNELS } from '../../components/AddCampaignModal.jsx';
import { ICONS } from '../../components/icons.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_NAMES } from '../../lib/audit.js';
import { currency, currencyShort, formatDate } from '../../lib/format.js';
import { StatusPill } from './AccountsPage.jsx';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const inputClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/50 focus:ring-2 focus:ring-brand-500/15';
const selectClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-sm text-fg outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60';
const primaryButton =
  'rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:opacity-60';
const secondaryButton =
  'rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-50';
const linkClass = 'text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200';

const Field = ({ label, children }) => (
  <div>
    <label className="mb-1 block text-sm font-medium text-fg-soft">{label}</label>
    {children}
  </div>
);

const FormError = ({ error }) =>
  error ? (
    <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
  ) : null;

function AddDealModal({ owner, campaigns, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', value: '', stage: 'lead', expected_close_date: '', campaign_id: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post(`/admin/users/${owner.id}/deals`, { ...form, value: Number(form.value) });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the deal');
      setSaving(false);
    }
  };

  return (
    <Modal title={`New deal for ${owner.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Field label="Title">
          <input value={form.title} onChange={set('title')} className={inputClass} placeholder="e.g. Office supplies order" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value (KES)">
            <input type="number" min="0" step="0.01" value={form.value} onChange={set('value')} className={inputClass} required />
          </Field>
          <Field label="Stage">
            <select value={form.stage} onChange={set('stage')} className={`${inputClass} capitalize`}>
              {STAGES.map((s) => (
                <option key={s} value={s} className="bg-surface">
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected close">
            <input type="date" value={form.expected_close_date} onChange={set('expected_close_date')} className={`${inputClass} dark:[color-scheme:dark]`} />
          </Field>
          <Field label="Campaign">
            <select value={form.campaign_id} onChange={set('campaign_id')} className={inputClass}>
              <option value="" className="bg-surface">None</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} className="bg-surface">
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button type="submit" disabled={saving} className={`${primaryButton} w-full py-2.5`}>
          {saving ? 'Saving…' : 'Add deal'}
        </button>
      </form>
    </Modal>
  );
}

function AddCampaignModal({ owner, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', budget: '', channel: '', start_date: '', end_date: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post(`/admin/users/${owner.id}/campaigns`, form);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the campaign');
      setSaving(false);
    }
  };

  return (
    <Modal title={`New campaign for ${owner.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Field label="Campaign name">
          <input value={form.name} onChange={set('name')} className={inputClass} placeholder="e.g. Q4 Nairobi Radio Push" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Budget (KES)">
            <input type="number" min="0" step="0.01" value={form.budget} onChange={set('budget')} className={inputClass} placeholder="0" />
          </Field>
          <Field label="Channel">
            <select value={form.channel} onChange={set('channel')} className={inputClass}>
              <option value="" className="bg-surface">Not set</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c} className="bg-surface">
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <input type="date" value={form.start_date} onChange={set('start_date')} className={`${inputClass} dark:[color-scheme:dark]`} />
          </Field>
          <Field label="End date">
            <input type="date" value={form.end_date} onChange={set('end_date')} className={`${inputClass} dark:[color-scheme:dark]`} />
          </Field>
        </div>
        <button type="submit" disabled={saving} className={`${primaryButton} w-full py-2.5`}>
          {saving ? 'Saving…' : 'Add campaign'}
        </button>
      </form>
    </Modal>
  );
}

// Everything about one account in one place, so an admin can step in if something goes wrong
export default function AccountDetailPage() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [allCampaigns, setAllCampaigns] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // 'deal' | 'campaign'
  const [resetLink, setResetLink] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () =>
      api
        .get(`/admin/users/${id}`)
        .then((res) => setData(res.data))
        .catch((err) => setError(err.response?.data?.error || 'Could not load this account')),
    [id]
  );

  useEffect(() => {
    load();
    api
      .get('/campaigns')
      .then((res) => setAllCampaigns(res.data.campaigns))
      .catch(() => {});
  }, [load]);

  const act = async (action, success) => {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the change');
    } finally {
      setSaving(false);
    }
  };

  const createResetLink = () =>
    act(async () => {
      const res = await api.post(`/admin/users/${id}/reset-link`);
      setResetLink({ url: `${window.location.origin}${res.data.resetPath}`, minutes: res.data.validMinutes });
      setCopied(false);
    }, 'Reset link created. Send it to them privately.');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLink.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!data) {
    return (
      <DashboardShell title="Account">
        {error ? (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : (
          <div className="py-20 text-center text-sm text-muted">Loading…</div>
        )}
      </DashboardShell>
    );
  }

  const { user, deals, campaigns, activityCount, recentAudit } = data;
  const isSelf = user.id === me.id;
  const active = user.is_active !== false;
  const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const wonDeals = deals.filter((d) => d.stage === 'won');
  const sum = (list) => list.reduce((s, d) => s + Number(d.value), 0);
  const campaignName = Object.fromEntries(allCampaigns.map((c) => [c.id, c.name]));

  return (
    <DashboardShell title="Account">
      <Link to="/admin/accounts" className={`${linkClass} mb-4 inline-block`}>
        ← All accounts
      </Link>

      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            {user.name} <StatusPill active={active} />
          </span>
        }
        subtitle={`${user.email} · ${ROLE_NAMES[user.role]} · joined ${formatDate(user.created_at)}`}
        className="mb-6"
      >
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            Role
            <select
              value={user.role}
              disabled={isSelf || saving}
              onChange={(e) => act(() => api.patch(`/users/${user.id}/role`, { role: e.target.value }), `Role changed to ${ROLE_NAMES[e.target.value]}.`)}
              className={selectClass}
            >
              {Object.entries(ROLE_NAMES).map(([value, label]) => (
                <option key={value} value={value} className="bg-surface">
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!isSelf &&
            (active ? (
              <ConfirmButton
                label="Disable account"
                confirmLabel="Disable and sign them out?"
                disabled={saving}
                onConfirm={() => act(() => api.patch(`/users/${user.id}/status`, { active: false }), `${user.name} is disabled.`)}
                className="!py-1.5 !text-sm"
              />
            ) : (
              <button
                onClick={() => act(() => api.patch(`/users/${user.id}/status`, { active: true }), `${user.name} can log in again.`)}
                disabled={saving}
                className="rounded-lg border border-emerald-400/40 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
              >
                Enable account
              </button>
            ))}
          <button onClick={createResetLink} disabled={saving || !active} className={secondaryButton} title={active ? undefined : 'Enable the account first'}>
            Create password reset link
          </button>
          {isSelf && <span className="text-xs text-subtle">This is your account, so role and status are locked.</span>}
        </div>

        {resetLink && (
          <div className="mx-5 mb-4 rounded-xl border border-brand-400/30 bg-brand-500/5 p-3 text-sm">
            <p className="mb-2 text-fg-soft">
              Send this link to {user.name}. It works once, for {resetLink.minutes} minutes.
            </p>
            <div className="flex gap-2">
              <input readOnly value={resetLink.url} onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-xs`} aria-label="Password reset link" />
              <button onClick={copyLink} className={primaryButton}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {(error || notice) && (
          <div className="border-t border-fg/10 px-5 py-3 text-sm">
            {error && <span className="text-red-700 dark:text-red-300">{error}</span>}
            {notice && <span className="text-emerald-700 dark:text-emerald-300">{notice}</span>}
          </div>
        )}
      </Panel>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Deals" value={deals.length} hint={`${openDeals.length} open`} icon={ICONS.pipeline} />
        <StatCard label="Open value" value={currencyShort(sum(openDeals))} fullValue={currency(sum(openDeals))} hint="Not yet won or lost" icon={ICONS.open} tone="sky" />
        <StatCard label="Won value" value={currencyShort(sum(wonDeals))} fullValue={currency(sum(wonDeals))} hint={`${wonDeals.length} won`} icon={ICONS.won} tone="emerald" />
        <StatCard label="Activities" value={activityCount} hint="Calls, emails, meetings, notes" icon={ICONS.target} tone="gold" />
      </div>

      <div className="space-y-6">
        <Panel
          title="Deals"
          subtitle={`Deals owned by ${user.name}`}
          action={
            <button onClick={() => setModal('deal')} className={primaryButton}>
              + Add deal
            </button>
          }
        >
          {deals.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No deals yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-fg/10 text-left text-xs uppercase tracking-wide text-subtle">
                    <th className="px-5 py-3 font-medium">Deal</th>
                    <th className="px-3 py-3 font-medium">Stage</th>
                    <th className="px-3 py-3 text-right font-medium">Value</th>
                    <th className="px-3 py-3 font-medium">Campaign</th>
                    <th className="px-3 py-3 font-medium">Close date</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-fg/5">
                  {deals.map((d) => (
                    <tr key={d.id} className="hover:bg-fg/[0.03]">
                      <td className="px-5 py-3 font-medium text-fg">{d.title}</td>
                      <td className="px-3 py-3">
                        <StageBadge stage={d.stage} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted">{currency(d.value)}</td>
                      <td className="px-3 py-3 text-muted">{d.campaign_id ? campaignName[d.campaign_id] || '—' : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDate(d.expected_close_date)}</td>
                      <td className="px-5 py-3 text-right">
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete?"
                          onConfirm={() => act(() => api.delete(`/admin/deals/${d.id}`), `Deleted “${d.title}”.`)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Campaigns"
          subtitle="Campaigns they created, and campaigns their deals came from"
          action={
            <button onClick={() => setModal('campaign')} className={primaryButton}>
              + Add campaign
            </button>
          }
        >
          {campaigns.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No campaigns linked to this account.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-fg/10 text-left text-xs uppercase tracking-wide text-subtle">
                    <th className="px-5 py-3 font-medium">Campaign</th>
                    <th className="px-3 py-3 font-medium">Channel</th>
                    <th className="px-3 py-3 text-right font-medium">Budget</th>
                    <th className="px-3 py-3 text-right font-medium">Their deals</th>
                    <th className="px-3 py-3 font-medium">How linked</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-fg/5">
                  {campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-fg/[0.03]">
                      <td className="px-5 py-3 font-medium text-fg">{c.name}</td>
                      <td className="px-3 py-3 text-muted">{c.channel || '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted">{currency(c.budget)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted">{c.dealCount}</td>
                      <td className="px-3 py-3 text-muted">{c.relation === 'created' ? 'Created by them' : 'Through their deals'}</td>
                      <td className="px-5 py-3 text-right">
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete for everyone?"
                          onConfirm={() => act(() => api.delete(`/admin/campaigns/${c.id}`), `Deleted “${c.name}”. Its deals were kept.`)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Recent activity"
          subtitle={`The last things ${user.name} did`}
          action={
            <Link to={`/admin/audit?user=${user.id}&name=${encodeURIComponent(user.name)}`} className={linkClass}>
              Full history
            </Link>
          }
        >
          <AuditList entries={recentAudit} />
        </Panel>
      </div>

      {modal === 'deal' && (
        <AddDealModal
          owner={user}
          campaigns={allCampaigns}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            setNotice('Deal added.');
            load();
          }}
        />
      )}
      {modal === 'campaign' && (
        <AddCampaignModal
          owner={user}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            setNotice('Campaign added.');
            load();
            api.get('/campaigns').then((res) => setAllCampaigns(res.data.campaigns)).catch(() => {});
          }}
        />
      )}
    </DashboardShell>
  );
}

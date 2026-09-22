import React, { useState } from 'react';
import api from '../api/client.js';
import Modal from './Modal.jsx';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const inputClass =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';

export default function AddDealModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stage, setStage] = useState('lead');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/deals', {
        title,
        value: Number(value),
        stage,
        expected_close_date: expectedCloseDate || null,
      });
      onCreated(data.deal);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create deal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Add a deal" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Deal title</label>
          <input
            type="text"
            placeholder="e.g. Acme Corp — Annual Contract"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Value (KES)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={`${inputClass} appearance-none`}>
              {STAGES.map((s) => (
                <option key={s} value={s} className="bg-slate-900 capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Expected close date (optional)</label>
          <input
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
            className={`${inputClass} [color-scheme:dark]`}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'Add deal'}
        </button>
      </form>
    </Modal>
  );
}

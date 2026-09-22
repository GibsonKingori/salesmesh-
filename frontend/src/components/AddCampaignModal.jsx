import React, { useState } from 'react';
import api from '../api/client.js';
import Modal from './Modal.jsx';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-brand-400/50 focus:ring-2 focus:ring-brand-500/15';

export default function AddCampaignModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/campaigns', {
        name,
        budget: Number(budget) || 0,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      onCreated(data.campaign);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create campaign');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="New campaign" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Campaign name</label>
          <input
            type="text"
            placeholder="e.g. Q4 Nairobi Radio Push"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Budget (KES)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`${inputClass} [color-scheme:dark]`}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`${inputClass} [color-scheme:dark]`}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'Create campaign'}
        </button>
      </form>
    </Modal>
  );
}

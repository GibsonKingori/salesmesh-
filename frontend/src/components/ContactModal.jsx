import React, { useState } from 'react';
import api from '../api/client.js';
import Modal from './Modal.jsx';

const inputClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';

const FIELDS = ['name', 'company', 'phone', 'email'];

// Add a contact, or edit/delete one when `contact` is passed. `linkedDeals` is only used to
// warn before deleting: those deals keep existing, they just lose their contact.
export default function ContactModal({ contact, linkedDeals = 0, onClose, onSaved }) {
  const isEdit = Boolean(contact);
  const [form, setForm] = useState(() =>
    Object.fromEntries(FIELDS.map((f) => [f, contact?.[f] || '']))
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isEdit) await api.patch(`/contacts/${contact.id}`, form);
      else await api.post('/contacts', form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the contact');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setError('');
    setSaving(true);
    try {
      await api.delete(`/contacts/${contact.id}`);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete the contact');
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit contact' : 'Add a contact'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-soft">Name</label>
          <input
            type="text"
            placeholder="e.g. Wanjiru Kamau"
            value={form.name}
            onChange={set('name')}
            className={inputClass}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-soft">Company (optional)</label>
          <input type="text" value={form.company} onChange={set('company')} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg-soft">Phone</label>
            <input
              type="tel"
              placeholder="+254 7…"
              value={form.phone}
              onChange={set('phone')}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg-soft">Email</label>
            <input type="email" value={form.email} onChange={set('email')} className={inputClass} />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add contact'}
        </button>
      </form>

      {isEdit &&
        (confirmDelete ? (
          <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm">
            <p className="text-red-700 dark:text-red-300">
              Delete {contact.name}?
              {linkedDeals > 0 &&
                ` ${linkedDeals} linked deal${linkedDeals === 1 ? '' : 's'} will keep existing without a contact.`}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-3 w-full text-center text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
          >
            Delete contact
          </button>
        ))}
    </Modal>
  );
}

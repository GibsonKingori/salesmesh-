import React, { useEffect, useState } from 'react';

const TONES = {
  danger: 'border-red-400/30 text-red-700 hover:bg-red-500/10 dark:text-red-300',
  neutral: 'border-fg/10 text-fg-soft hover:bg-fg/10 hover:text-fg',
};

// Two-step button for destructive actions: the first click asks "Sure?", the second runs it.
// Avoids browser confirm() dialogs and resets itself after a few seconds.
export default function ConfirmButton({ label, confirmLabel = 'Click again to confirm', onConfirm, disabled, tone = 'danger', className = '' }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const handleClick = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      className={`whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        armed ? 'border-red-500 bg-red-600 text-white hover:bg-red-500' : TONES[tone]
      } ${className}`}
    >
      {busy ? 'Working…' : armed ? confirmLabel : label}
    </button>
  );
}

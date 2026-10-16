import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { IDLE_MINUTES, lastActive, markActive } from '../lib/idle.js';

const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const WARN_MS = 60 * 1000; // the warning shows for the last minute
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'scroll', 'touchstart'];

// Signs the user out after IDLE_MINUTES with no mouse, keyboard or touch activity. The last
// activity time is shared through localStorage, so working in one tab keeps every tab signed in,
// and they all sign out together. A laptop waking from sleep is checked straight away.
export default function IdleLogout() {
  const { user, logout } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    if (!lastActive()) markActive(); // first visit since this was added

    let signingOut = false;
    let lastWrite = 0;
    const onActivity = () => {
      // mousemove fires constantly; writing every few seconds is plenty
      if (Date.now() - lastWrite < 5000) return;
      lastWrite = Date.now();
      markActive();
    };

    const check = async () => {
      const idleFor = Date.now() - lastActive();
      if (idleFor >= IDLE_MS) {
        if (signingOut) return;
        signingOut = true;
        await logout();
        window.location.assign('/login?idle=1');
      } else if (idleFor >= IDLE_MS - WARN_MS) {
        setSecondsLeft(Math.ceil((IDLE_MS - idleFor) / 1000));
      } else {
        setSecondsLeft(null);
      }
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 1000);
    check();
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [user, logout]);

  if (!user || secondsLeft === null) return null;

  const stay = () => {
    markActive();
    setSecondsLeft(null);
  };

  return (
    <Modal title="Are you still there?" onClose={stay}>
      <p className="text-sm text-fg-soft">
        You've been inactive for a while. For your security you'll be logged out in{' '}
        <span className="font-semibold tabular-nums text-fg">{secondsLeft}s</span>.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={async () => {
            await logout();
            window.location.assign('/login');
          }}
          className="rounded-lg border border-fg/10 px-4 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/5"
        >
          Log out now
        </button>
        <button
          type="button"
          autoFocus
          onClick={stay}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
        >
          Stay logged in
        </button>
      </div>
    </Modal>
  );
}

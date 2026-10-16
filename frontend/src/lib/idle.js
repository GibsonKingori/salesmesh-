// Minutes without mouse, keyboard or touch activity before the user is logged out
// (components/IdleLogout.jsx). Override with VITE_IDLE_TIMEOUT_MINUTES in frontend/.env.
export const IDLE_MINUTES = Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES) || 10;

// Shared through localStorage so activity in one tab keeps the others signed in
const LAST_ACTIVE_KEY = 'salesmesh_last_active';
let inMemory = 0; // used when storage is blocked: each tab then times out on its own

export function markActive() {
  inMemory = Date.now();
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(inMemory));
  } catch {
    /* storage blocked */
  }
}

export function lastActive() {
  try {
    return Number(localStorage.getItem(LAST_ACTIVE_KEY)) || inMemory;
  } catch {
    return inMemory;
  }
}

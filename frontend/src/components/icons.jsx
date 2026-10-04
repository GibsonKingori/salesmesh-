import React from 'react';

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

export const ICONS = {
  pipeline: <Icon d="M3 3v18h18M7 15l4-5 3 3 5-7" />,
  open: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  ),
  won: <Icon d="M5 13l4 4L19 7" />,
  forecast: <Icon d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  target: <Icon d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4l-1.4 1.4M7 17l-1.4 1.4m0-12.8L7 7m10 10l1.4 1.4M12 16a4 4 0 100-8 4 4 0 000 8z" />,
  users: <Icon d="M17 20h5v-2a4 4 0 00-5-3.9M9 20H2v-2a4 4 0 014-4h3a4 4 0 014 4v2zm3-12a3 3 0 11-6 0 3 3 0 016 0zm8 1a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />,
  shield: <Icon d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  database: <Icon d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  alert: <Icon d="M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
};

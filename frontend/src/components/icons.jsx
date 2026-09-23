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
};

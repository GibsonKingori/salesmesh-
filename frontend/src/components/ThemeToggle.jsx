import React from 'react';
import { useTheme } from '../context/ThemeContext.jsx';

const iconProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, className: 'h-4 w-4', 'aria-hidden': true };

const OPTIONS = [
  {
    value: 'light',
    label: 'Light theme',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark theme',
    icon: (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.4 14.5A8.5 8.5 0 019.5 3.6a8.5 8.5 0 1010.9 10.9z" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Match my computer',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path strokeLinecap="round" d="M8 20h8m-4-4v4" />
      </svg>
    ),
  },
];

// Light / Dark / Match my computer. Used in the dashboard header and on the login page.
export default function ThemeToggle({ className = '' }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex rounded-lg border border-fg/10 bg-fg/5 p-0.5 ${className}`}>
      {OPTIONS.map((opt) => {
        const selected = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={`rounded-md p-1.5 transition-colors ${
              selected ? 'bg-fg/10 text-fg shadow-sm' : 'text-muted hover:text-fg'
            }`}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

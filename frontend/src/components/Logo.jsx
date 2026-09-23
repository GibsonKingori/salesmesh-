import React, { useId } from 'react';

// SalesMesh mark: three rising sales bars whose tops are joined into a small network (the
// "mesh"), with the peak node in savanna gold for growth. Keep in sync with public/favicon.svg.
export function LogoMark({ className = 'h-9 w-9' }) {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="SalesMesh">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#26d3a0" />
          <stop offset="1" stopColor="#04775b" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id}-bg)`} />
      <rect x="0.5" y="0.5" width="47" height="47" rx="11.5" fill="none" stroke="#fff" strokeOpacity="0.18" />

      {/* rising bars */}
      <rect x="11" y="27" width="7" height="11" rx="2" fill="#fff" fillOpacity="0.28" />
      <rect x="20.5" y="21" width="7" height="17" rx="2" fill="#fff" fillOpacity="0.45" />
      <rect x="30" y="15" width="7" height="23" rx="2" fill="#fff" fillOpacity="0.65" />

      {/* mesh: every node linked, the trend line brightest */}
      <path d="M14.5 21 L33.5 9" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.5 21 L24 15.5 L33.5 9" fill="none" stroke="#fff" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14.5" cy="21" r="2.6" fill="#fff" />
      <circle cx="24" cy="15.5" r="2.6" fill="#fff" />
      <circle cx="33.5" cy="9" r="3.4" fill="#f9c243" stroke="#04775b" strokeWidth="1.25" />
    </svg>
  );
}

export default function Logo({ markClassName = 'h-9 w-9', textClassName = 'text-base', subtitle }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={markClassName} />
      <div>
        <p className={`font-display font-semibold leading-none tracking-tight text-fg ${textClassName}`}>
          Sales<span className="text-brand-700 dark:text-brand-300">Mesh</span>
        </p>
        {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

import React from 'react';
import { LogoMark } from './Logo.jsx';

export default function SplashScreen() {
  return (
    <div className="dark fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-canvas">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-xl bg-brand-500/20" />
        <LogoMark className="relative h-14 w-14" />
      </div>
      <p className="font-display text-sm font-medium tracking-wide text-muted">
        Sales<span className="text-brand-700 dark:text-brand-300">Mesh</span>
      </p>
    </div>
  );
}

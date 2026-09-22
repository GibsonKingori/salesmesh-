import React from 'react';

export default function SplashScreen() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-slate-950">
      <div className="relative flex h-12 w-12 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-xl bg-brand-600/20" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 font-display text-lg font-bold text-white">
          S
        </div>
      </div>
      <p className="font-display text-sm font-medium tracking-wide text-slate-500">SalesMesh</p>
    </div>
  );
}

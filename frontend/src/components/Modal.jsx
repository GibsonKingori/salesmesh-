import React from 'react';
import { createPortal } from 'react-dom';

// Rendered into <body> so it always covers the screen: inside an animated (transformed) page
// section, "fixed" would be relative to that section and the dialog could end up off screen.
export default function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-canvas/40 backdrop-blur-sm" onClick={onClose} />
      {/* Tall content scrolls inside the panel so the title and close button stay on screen */}
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md animate-fade-in-up flex-col rounded-2xl border border-fg/10 bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex shrink-0 items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fg/10 hover:text-fg"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">{children}</div>
      </div>
    </div>,
    document.body
  );
}

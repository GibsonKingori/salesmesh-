import React, { createContext, useContext, useEffect, useState } from 'react';

// Light, dark, or whatever the computer is set to. The choice is remembered per browser; index.html
// applies it before the app loads, so the page never flashes the wrong theme.
export const THEME_KEY = 'salesmesh_theme';
export const THEMES = ['light', 'dark', 'system'];

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function readSaved() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : 'system';
  } catch {
    return 'system'; // storage blocked (private window, etc.)
  }
}

// The whole app turns dark through the "dark" class on <html> (tailwind.config.js, index.css)
function apply(theme) {
  const dark = theme === 'dark' || (theme === 'system' && Boolean(darkQuery()?.matches));
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

const ThemeContext = createContext({ theme: 'system', setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readSaved);

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* not remembered, but still applied */
    }
    if (theme !== 'system') return undefined;
    // Follow the computer switching between light and dark (e.g. at sunset)
    const query = darkQuery();
    const onChange = () => apply('system');
    query?.addEventListener('change', onChange);
    return () => query?.removeEventListener('change', onChange);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

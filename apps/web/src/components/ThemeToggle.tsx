'use client';
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

type Theme = 'light' | 'dark';
const KEY = 'bm-theme';

/**
 * Runs in <head> before the page paints, so a saved choice never flashes the
 * other theme. With no saved choice the phone's own setting decides (CSS).
 */
export const themeScript = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light/dark switch. The choice is kept on this device only. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);

  function toggle() {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private browsing: the switch still works until the tab closes.
    }
    setTheme(next);
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-panel"
    >
      {theme === 'dark' ? <SunIcon /> : theme === 'light' ? <MoonIcon /> : null}
    </button>
  );
}

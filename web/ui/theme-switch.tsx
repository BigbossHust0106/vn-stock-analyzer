'use client';
import { useSyncExternalStore } from 'react';
function snapshot() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function subscribe(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function update() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('vn-stock-theme');
    } catch {
      /* Storage bị chặn: dùng lựa chọn hệ thống/DOM. */
    }
    document.documentElement.dataset.theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : media.matches
          ? 'dark'
          : 'light';
  }
  update();
  window.addEventListener('storage', update);
  media.addEventListener('change', update);
  return () => {
    observer.disconnect();
    window.removeEventListener('storage', update);
    media.removeEventListener('change', update);
  };
}
export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'dark');
  const dark = theme === 'dark';
  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('vn-stock-theme', next);
    } catch {
      /* Storage bị chặn: dùng lựa chọn hệ thống/DOM. */
    }
  }
  return (
    <button
      className="theme-button"
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
      aria-pressed={dark}
    >
      {dark ? '☀ Sáng' : '◐ Tối'}
    </button>
  );
}

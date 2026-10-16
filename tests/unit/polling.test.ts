import { afterEach, expect, it, vi } from 'vitest';
import { pollVisible } from '../../web/lib/polling';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('10-second serial refresh, hidden/offline pause, immediate focus/online resume and cleanup', async () => {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    win = Object.assign(new EventTarget(), { setInterval, clearInterval }),
    nav = { onLine: true };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  let release: () => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const stop = pollVisible(load);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20000);
  expect(load).toHaveBeenCalledTimes(1); // Still in-flight; never overlap.
  release();
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(2);
  release();
  await Promise.resolve();
  doc.visibilityState = 'hidden';
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(2);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(load).toHaveBeenCalledTimes(3);
  release();
  await Promise.resolve();
  nav.onLine = false;
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(3);
  nav.onLine = true;
  win.dispatchEvent(new Event('online'));
  expect(load).toHaveBeenCalledTimes(4);
  release();
  await Promise.resolve();
  win.dispatchEvent(new Event('focus'));
  expect(load).toHaveBeenCalledTimes(5);
  release();
  stop();
  await vi.advanceTimersByTimeAsync(30000);
  win.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(load).toHaveBeenCalledTimes(5);
});

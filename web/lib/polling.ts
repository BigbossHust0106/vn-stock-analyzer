// Serial polling: no overlapping requests; resume immediately on focus/network return.
export function pollVisible(load: () => Promise<unknown>, intervalMs = 10000) {
  let stopped = false,
    busy = false;
  const update = async () => {
    if (
      stopped ||
      busy ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine
    )
      return;
    busy = true;
    try {
      await load();
    } finally {
      busy = false;
    }
  };
  const resume = () => {
    void update();
  };
  const timer = window.setInterval(resume, intervalMs);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  resume();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('online', resume);
  };
}

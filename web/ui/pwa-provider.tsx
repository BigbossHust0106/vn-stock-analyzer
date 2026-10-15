'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
const InstallContext = createContext<{
  available: boolean;
  standalone: boolean;
  install: () => Promise<void>;
  status: string;
}>({
  available: false,
  standalone: false,
  install: async () => {},
  status: '',
});
function standaloneSnapshot() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function subscribeStandalone(changed: () => void) {
  const media = window.matchMedia('(display-mode: standalone)');
  media.addEventListener('change', changed);
  window.addEventListener('appinstalled', changed);
  return () => {
    media.removeEventListener('change', changed);
    window.removeEventListener('appinstalled', changed);
  };
}
function subscribeOnline(changed: () => void) {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
}
export function usePwaInstall() {
  return useContext(InstallContext);
}
export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [status, setStatus] = useState('');
  const [update, setUpdate] = useState<ServiceWorkerRegistration | null>(null);
  const reloadRequested = useRef(false);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    standaloneSnapshot,
    () => false,
  );
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  useEffect(() => {
    const installEvent = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const installed = () => {
      setPrompt(null);
      setStatus(
        'Yêu cầu cài đặt đã được trình duyệt xử lý. Bạn có thể mở VN Stock từ màn hình chính.',
      );
    };
    window.addEventListener('beforeinstallprompt', installEvent);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', installEvent);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const controlled = () => {
      if (reloadRequested.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', controlled);
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (disposed) return;
        if (reg.waiting) setUpdate(reg);
        const changed = () => {
          const worker = reg.installing;
          if (!worker) return;
          const state = () => {
            if (
              !disposed &&
              worker.state === 'installed' &&
              navigator.serviceWorker.controller
            )
              setUpdate(reg);
          };
          worker.addEventListener('statechange', state);
          cleanups.push(() => worker.removeEventListener('statechange', state));
        };
        reg.addEventListener('updatefound', changed);
        cleanups.push(() => reg.removeEventListener('updatefound', changed));
        changed();
      })
      .catch(() => {
        if (!disposed)
          setStatus(
            'Chưa đăng ký được chế độ ứng dụng. Bạn vẫn có thể dùng website và thử cài lại khi mạng ổn định.',
          );
      });
    return () => {
      disposed = true;
      cleanups.forEach((clean) => clean());
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        controlled,
      );
    };
  }, []);
  async function install() {
    if (!prompt) return;
    const pending = prompt;
    setPrompt(null);
    try {
      await pending.prompt();
      const choice = await pending.userChoice;
      setStatus(
        choice.outcome === 'accepted'
          ? 'Đã gửi yêu cầu cài đặt. Làm theo trình duyệt để hoàn tất.'
          : 'Bạn có thể cài lại bất cứ lúc nào từ mục Cài ứng dụng.',
      );
    } catch {
      setStatus(
        'Chưa mở được cửa sổ cài đặt. Dùng menu trình duyệt theo hướng dẫn bên dưới.',
      );
    }
  }
  return (
    <InstallContext.Provider
      value={{ available: !!prompt, standalone, install, status }}
    >
      {!online && (
        <div className="connection-banner" role="status">
          Bạn đang ngoại tuyến. Dữ liệu đang thấy đã được tải trước đó, không
          phải cập nhật trực tiếp.
        </div>
      )}
      {update && (
        <div className="update-banner" role="status">
          Có phiên bản VN Stock mới.{' '}
          <button
            onClick={() => {
              if (update.waiting) {
                reloadRequested.current = true;
                update.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
              } else window.location.reload();
            }}
          >
            Cập nhật ứng dụng
          </button>
        </div>
      )}
      {children}
    </InstallContext.Provider>
  );
}

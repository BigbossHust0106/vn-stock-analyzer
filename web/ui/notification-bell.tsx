'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from './auth-provider';
import {
  notificationRequest,
  type NotificationFeed,
} from '../lib/notifications';
export function NotificationBell() {
  const { user } = useAuth();
  return user ? <Bell key={user.id} /> : null;
}
function Bell() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false,
      pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const r = await notificationRequest<NotificationFeed>(
          '/v1/notifications',
          undefined,
          controller.signal,
        );
        if (!stopped) setCount(r.unread);
      } catch {
        if (!stopped) setCount(null);
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    window.addEventListener('notifications-changed', load);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('notifications-changed', load);
    };
  }, []);
  return (
    <Link
      href="/alerts"
      aria-label={
        count === null
          ? 'Cảnh báo, chưa tải được số chưa đọc'
          : `Cảnh báo, ${count} chưa đọc`
      }
      className="notification-link"
    >
      Cảnh báo{' '}
      <span className="notification-count" data-testid="notification-count">
        {count === null ? '…' : count > 99 ? '99+' : count}
      </span>
    </Link>
  );
}

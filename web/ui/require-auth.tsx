'use client';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from './auth-provider';
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready, error } = useAuth();
  useEffect(() => {
    if (ready && !user && !error)
      window.location.replace(
        '/login?next=' +
          encodeURIComponent(window.location.pathname + window.location.search),
      );
  }, [ready, user, error]);
  if (error)
    return (
      <div className="session-gate" role="alert">
        {error} <a href="/login">Đăng nhập lại</a>
      </div>
    );
  if (!ready || !user)
    return (
      <div className="session-gate" role="status">
        <span className="session-mark" aria-hidden="true">
          ↗
        </span>
        Đang kiểm tra đăng nhập…
      </div>
    );
  // Dữ liệu cá nhân chỉ tải sau getUser; RLS là bảo vệ tại database.
  return <div key={user.id}>{children}</div>;
}

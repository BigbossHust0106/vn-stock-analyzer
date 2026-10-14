'use client';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from './auth-provider';
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready, error } = useAuth();
  useEffect(() => {
    if (ready && !user && !error)
      window.location.replace(
        '/login?next=' + encodeURIComponent(window.location.pathname),
      );
  }, [ready, user, error]);
  if (error)
    return (
      <p role="alert">
        {error} <a href="/login">Đăng nhập lại</a>
      </p>
    );
  if (!ready || !user) return <p role="status">Đang kiểm tra đăng nhập…</p>;
  // Dữ liệu cá nhân chỉ tải sau getUser; RLS là bảo vệ tại database.
  return <div key={user.id}>{children}</div>;
}

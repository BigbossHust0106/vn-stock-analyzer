'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useAuth } from './auth-provider';
import { settingsClient } from '../lib/scoring-settings';
export function AuthNav() {
  const { user, ready } = useAuth();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  if (!ready) return <span>Đang kiểm tra phiên…</span>;
  return user ? (
    <div
      className="account-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="account-trigger"
        aria-label="Menu tài khoản"
        aria-expanded={open}
        aria-controls="account-options"
        onClick={() => setOpen(!open)}
      >
        <AccountAvatar
          key={user.id}
          metadata={user.user_metadata}
          email={user.email ?? ''}
        />
        <span className="account-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <nav
          id="account-options"
          className="account-dropdown"
          aria-label="Quản lý tài khoản"
        >
          <div className="account-identity">
            <strong>
              {typeof user.user_metadata.full_name === 'string'
                ? user.user_metadata.full_name
                : 'Tài khoản của bạn'}
            </strong>
            <small>{user.email}</small>
          </div>
          <Link href="/settings" onClick={() => setOpen(false)}>
            Cài đặt tài khoản & chiến lược
          </Link>
          <Link href="/paper" onClick={() => setOpen(false)}>
            Ví đầu tư thử
          </Link>
          <Link href="/huong-dan" onClick={() => setOpen(false)}>
            Hướng dẫn sử dụng
          </Link>
          <Link href="/install" onClick={() => setOpen(false)}>
            Cài ứng dụng điện thoại
          </Link>
          <Link href="/backtest" onClick={() => setOpen(false)}>
            Lịch sử & backtest Top 10
          </Link>
          <Link href="/status" onClick={() => setOpen(false)}>
            Trạng thái hệ thống
          </Link>
          <Link href="/watchlists" onClick={() => setOpen(false)}>
            Danh sách theo dõi
          </Link>
          <Link href="/auth/password" onClick={() => setOpen(false)}>
            Đổi mật khẩu
          </Link>
          <button
            onClick={() =>
              void settingsClient()
                .then((db) => db.auth.signOut())
                .then(({ error }) => {
                  if (error) setError('Không đăng xuất được.');
                })
                .catch(() => setError('Không đăng xuất được.'))
            }
          >
            Đăng xuất
          </button>
          {error && <span role="alert">{error}</span>}
        </nav>
      )}
    </div>
  ) : (
    <Link href="/login">Đăng nhập</Link>
  );
}
function AccountAvatar({
  metadata,
  email,
}: {
  metadata: Record<string, unknown>;
  email: string;
}) {
  const [failed, setFailed] = useState(false);
  const value = metadata.avatar_url;
  let url: string | null = null;
  try {
    if (typeof value === 'string' && new URL(value).protocol === 'https:')
      url = value;
  } catch {
    /* Initials are the fallback. */
  }
  return url && !failed ? (
    <Image
      src={url}
      alt="Ảnh đại diện"
      width={36}
      height={36}
      unoptimized
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="account-initials" aria-hidden="true">
      {(email.slice(0, 2) || 'VN').toUpperCase()}
    </span>
  );
}

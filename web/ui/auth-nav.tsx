'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from './auth-provider';
import { settingsClient } from '../lib/scoring-settings';
export function AuthNav() {
  const { user, ready } = useAuth();
  const [error, setError] = useState('');
  if (!ready) return <span>Đang kiểm tra phiên…</span>;
  return user ? (
    <span>
      <span title={user.email}>Tài khoản</span>{' '}
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
    </span>
  ) : (
    <Link href="/login">Đăng nhập</Link>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { settingsClient } from '../lib/scoring-settings';
import { safeNext } from '../lib/auth';
let exchange: Promise<void> | undefined;
async function finish() {
  const url = new URL(window.location.href),
    code = url.searchParams.get('code');
  if (url.searchParams.has('error'))
    throw new Error('Đăng nhập bị hủy hoặc liên kết đã hết hạn.');
  if (!code) throw new Error('Thiếu mã xác nhận đăng nhập.');
  const db = await settingsClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  // Xóa code/error khỏi URL, không để chúng ở lịch sử hoặc Referer.
  window.history.replaceState(null, '', '/auth/callback');
  if (error)
    throw new Error(
      'Liên kết hết hạn hoặc được mở ở trình duyệt khác. Hãy yêu cầu lại liên kết.',
    );
  window.location.replace(
    url.searchParams.get('recovery') === '1'
      ? '/auth/password'
      : safeNext(url.searchParams.get('next')),
  );
}
export function AuthCallback() {
  const [message, setMessage] = useState('Đang xác nhận đăng nhập…');
  useEffect(() => {
    exchange ??= finish();
    void exchange.catch((e) =>
      setMessage(
        e instanceof Error ? e.message : 'Không xác nhận được đăng nhập.',
      ),
    );
  }, []);
  return (
    <section className="settings-panel">
      <h1>Xác nhận đăng nhập</h1>
      <p role="status">{message}</p>
      <a href="/login">Quay lại đăng nhập</a>
    </section>
  );
}

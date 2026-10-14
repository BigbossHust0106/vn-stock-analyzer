'use client';
import { useState } from 'react';
import { settingsClient, googleAuthEnabled } from '../lib/scoring-settings';
import { safeNext } from '../lib/auth';
export function LoginForm() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function submit(google = false) {
    setBusy(true);
    setMessage('');
    try {
      const db = await settingsClient(),
        next = safeNext(new URL(window.location.href).searchParams.get('next'));
      const callback =
        window.location.origin +
        '/auth/callback?next=' +
        encodeURIComponent(next);
      if (google) {
        if (!(await googleAuthEnabled()))
          throw new Error(
            'Google tạm chưa khả dụng. Bạn có thể đăng nhập bằng email và mật khẩu.',
          );
        const { error } = await db.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: callback },
        });
        if (error)
          throw new Error(
            'Google tạm chưa khả dụng. Bạn có thể đăng nhập bằng email và mật khẩu.',
          );
      } else if (mode === 'signup') {
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callback },
        });
        setPassword('');
        if (error)
          throw new Error(
            'Không đăng ký được; kiểm tra email, mật khẩu hoặc thử lại sau.',
          );
        if (data.session) window.location.assign(next);
        else
          setMessage('Kiểm tra email để xác nhận tài khoản, sau đó đăng nhập.');
      } else if (mode === 'reset') {
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo:
            window.location.origin + '/auth/callback?next=/settings&recovery=1',
        });
        if (error) throw new Error('Không gửi được email đặt lại mật khẩu.');
        setMessage('Nếu email hợp lệ, bạn sẽ nhận liên kết đặt lại mật khẩu.');
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        setPassword('');
        if (error)
          throw new Error(
            'Email hoặc mật khẩu chưa đúng, hoặc email chưa được xác nhận.',
          );
        window.location.assign(next);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Đăng nhập thất bại.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-panel auth-panel">
      <span className="eyebrow">TÀI KHOẢN VN STOCK</span>
      <h1>
        {mode === 'signup'
          ? 'Tạo tài khoản'
          : mode === 'reset'
            ? 'Đặt lại mật khẩu'
            : 'Đăng nhập'}
      </h1>
      <p>Lưu danh sách theo dõi và cài đặt riêng theo tài khoản.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode !== 'reset' && (
          <label>
            Mật khẩu
            <input
              required
              minLength={mode === 'signup' ? 8 : 1}
              type="password"
              autoComplete={
                mode === 'signup' ? 'new-password' : 'current-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button disabled={busy}>
          {busy
            ? 'Đang xử lý…'
            : mode === 'signup'
              ? 'Đăng ký'
              : mode === 'reset'
                ? 'Gửi email'
                : 'Đăng nhập'}
        </button>
      </form>
      <button disabled={busy} onClick={() => void submit(true)}>
        Tiếp tục với Google
      </button>
      <div className="action-row">
        <button
          disabled={busy}
          onClick={() => {
            setMode(mode === 'signup' ? 'login' : 'signup');
            setMessage('');
          }}
        >
          {mode === 'signup' ? 'Đã có tài khoản' : 'Tạo tài khoản mới'}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setMode(mode === 'reset' ? 'login' : 'reset');
            setMessage('');
          }}
        >
          Quên mật khẩu
        </button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}

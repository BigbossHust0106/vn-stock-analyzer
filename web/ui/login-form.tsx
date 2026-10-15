'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useAuth } from './auth-provider';
import { settingsClient, googleAuthEnabled } from '../lib/scoring-settings';
import { safeNext } from '../lib/auth';
function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M5 19 19 5M5 5h14v14" />
    </svg>
  );
}
export function LoginForm() {
  const { user, ready } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    if (ready && user)
      window.location.replace(
        safeNext(new URL(window.location.href).searchParams.get('next')),
      );
  }, [ready, user]);
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
  function switchMode(next: 'login' | 'signup' | 'reset') {
    setMode(next);
    setMessage('');
    setPassword('');
    setShowPassword(false);
  }
  if (ready && user)
    return (
      <main className="session-gate" role="status">
        Đang mở không gian của bạn…
      </main>
    );
  return (
    <main className="login-page">
      <section className="login-card" aria-label="Tài khoản VN Stock">
        <div className="login-left">
          <div className="login-brand" aria-label="VN Stock Việt Nam">
            <span className="login-brand-mark" aria-hidden="true">
              <ArrowIcon />
            </span>
            <span>
              VN<span className="login-brand-accent">Stock</span>
              <small>GÓC NHÌN DÀI HẠN</small>
            </span>
          </div>
          <div className="login-form-wrap">
            <span className="login-kicker">
              THẤU HIỂU GIÁ TRỊ. VỮNG VÀNG ĐẦU TƯ.
            </span>
            <h1>
              {mode === 'signup' ? (
                'Bắt đầu hành trình.'
              ) : mode === 'reset' ? (
                'Lấy lại mật khẩu.'
              ) : (
                <>
                  Chào mừng
                  <br />
                  trở lại.
                </>
              )}
            </h1>
            <p className="login-intro">
              {mode === 'signup'
                ? 'Tạo tài khoản để xây dựng góc nhìn đầu tư của riêng bạn.'
                : mode === 'reset'
                  ? 'Nhập email tài khoản. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.'
                  : 'Đăng nhập để tiếp tục hành trình đầu tư của bạn.'}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                required
                type="email"
                autoComplete="email"
                placeholder="ban@example.com"
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode !== 'reset' && (
                <>
                  <label htmlFor="login-password">Mật khẩu</label>
                  <div className="login-password">
                    <input
                      id="login-password"
                      required
                      minLength={mode === 'signup' ? 8 : 1}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={
                        mode === 'signup' ? 'new-password' : 'current-password'
                      }
                      placeholder={
                        mode === 'signup'
                          ? 'Ít nhất 8 ký tự'
                          : 'Nhập mật khẩu của bạn'
                      }
                      value={password}
                      disabled={busy}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-label={
                        showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={busy}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                        {showPassword && <path d="m3 3 18 18" />}
                      </svg>
                    </button>
                  </div>
                </>
              )}
              {mode === 'login' && (
                <div className="login-options">
                  <span>Chào bạn, nhà đầu tư.</span>
                  <button
                    type="button"
                    className="login-text-button"
                    disabled={busy}
                    onClick={() => switchMode('reset')}
                  >
                    Quên mật khẩu?
                  </button>
                </div>
              )}
              <button type="submit" className="login-submit" disabled={busy}>
                {busy
                  ? 'Đang xử lý…'
                  : mode === 'signup'
                    ? 'Tạo tài khoản'
                    : mode === 'reset'
                      ? 'Gửi liên kết đặt lại'
                      : 'Đăng nhập'}
                <span aria-hidden="true">
                  <ArrowIcon />
                </span>
              </button>
            </form>
            {mode !== 'reset' && (
              <>
                <div className="login-divider">
                  <span>hoặc tiếp tục với</span>
                </div>
                <button
                  type="button"
                  className="login-google"
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="#4285F4"
                      d="M22.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2.1-2 3.2-4.8 3.2-8.1Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .6-2.2 1-3.8 1-2.9 0-5.3-2-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.8 13.9a6.6 6.6 0 0 1 0-3.8V7.2H2.1a11 11 0 0 0 0 9.6Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.5c1.7 0 3.2.6 4.4 1.7l3.2-3.1A10.6 10.6 0 0 0 12 1a11 11 0 0 0-9.9 6.2l3.7 2.9C6.7 7.5 9.1 5.5 12 5.5Z"
                    />
                  </svg>
                  Tiếp tục với Google
                </button>
              </>
            )}
            <p className="login-switch">
              {mode === 'login'
                ? 'Chưa có tài khoản? '
                : mode === 'signup'
                  ? 'Đã có tài khoản? '
                  : 'Đã nhớ mật khẩu? '}
              <button
                type="button"
                className="login-text-button"
                disabled={busy}
                onClick={() =>
                  switchMode(mode === 'login' ? 'signup' : 'login')
                }
              >
                {mode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập'}
              </button>
            </p>
            <p className="login-message" role="status" aria-live="polite">
              {message}
            </p>
          </div>
          <p className="login-disclaimer">
            Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.
          </p>
        </div>
        <aside
          className="login-art"
          aria-label="Minh họa thị trường chứng khoán"
        >
          <div className="login-art-top">
            <span>VN STOCK / VIỆT NAM</span>
            <span className="login-art-number">01 — DÀI HẠN</span>
          </div>
          <div className="login-art-heading">
            <span className="login-art-eyebrow">
              GIÁ TRỊ HÔM NAY. TẦM NHÌN NGÀY MAI.
            </span>
            <h2>
              Đầu tư có cơ sở.
              <br />
              <em>Theo dõi có kỷ luật.</em>
            </h2>
            <p>
              Mỗi quyết định tốt bắt đầu
              <br />
              từ việc hiểu doanh nghiệp.
            </p>
          </div>
          <Image
            className="login-illustration"
            src="/market-bull.jpg"
            alt=""
            width={1280}
            height={960}
            priority
          />
          <div className="login-art-bottom">
            <span>
              HOSE <i /> HNX <i /> UPCOM
            </span>
            <span>KIÊN NHẪN LÀ LỢI THẾ</span>
          </div>
          <a
            className="image-credit"
            href="https://commons.wikimedia.org/wiki/File:Bulle_und_B%C3%A4r_Frankfurt_3.jpg"
            target="_blank"
            rel="noreferrer"
          >
            Ảnh: Eva K. / Wikimedia Commons · CC BY-SA 2.5
          </a>
        </aside>
      </section>
    </main>
  );
}

'use client';
import { useState } from 'react';
import { settingsClient } from '../lib/scoring-settings';
export function PasswordForm() {
  const [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section className="settings-panel">
      <h1>Mật khẩu mới</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void settingsClient()
            .then((db) => db.auth.updateUser({ password }))
            .then(({ error }) => {
              setPassword('');
              setMessage(
                error
                  ? 'Không cập nhật được mật khẩu.'
                  : 'Đã cập nhật mật khẩu.',
              );
            })
            .catch(() => setMessage('Không cập nhật được mật khẩu.'))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Mật khẩu mới
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>Lưu mật khẩu</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}

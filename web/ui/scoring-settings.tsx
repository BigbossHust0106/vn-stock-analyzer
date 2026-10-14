'use client';
import { useState } from 'react';
import {
  defaultSettings,
  validateSettings,
  type ScoringSettings,
} from '../../modules/settings/scoring-settings';
import {
  writeSettings,
  settingsClient,
  useSettingsAuth,
  useScoringSettings,
} from '../lib/scoring-settings';
export function ScoringSettingsForm() {
  const auth = useSettingsAuth();
  return (
    <SettingsEditor
      key={auth.ownerId ?? 'guest'}
      userId={auth.ownerId}
      initialized={auth.ready}
      authMessage={auth.message}
    />
  );
}
function SettingsEditor({
  userId,
  initialized,
  authMessage,
}: {
  userId: string | null;
  initialized: boolean;
  authMessage: string;
}) {
  const persisted = useScoringSettings();
  const [draft, setDraft] = useState<ScoringSettings | null>(null);
  const settings = draft ?? persisted;
  const [message, setMessage] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  function setSettings(value: ScoringSettings) {
    setDraft(value);
  }
  async function save() {
    if (!initialized) return;
    if (!validateSettings(settings)) {
      setMessage(
        'Trọng số phải cộng thành 100%. Tăng trưởng dài hạn phải thấp hơn chiết khấu; kiểm tra các giới hạn trên form.',
      );
      return;
    }
    setBusy(true);
    try {
      if (userId) {
        const db = await settingsClient();
        const { error } = await db
          .from('user_settings')
          .upsert({ owner_id: userId, scoring_preferences: settings });
        if (error)
          throw new Error(
            'Không lưu được Supabase; kiểm tra đăng nhập và migration.',
          );
      }
      writeSettings(settings, userId);
      setMessage(
        userId
          ? 'Đã lưu Supabase cho tài khoản của bạn và áp dụng trên trình duyệt này.'
          : 'Đã lưu trên trình duyệt này. Đăng nhập nếu muốn lưu theo tài khoản Supabase.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không lưu được cài đặt.');
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    try {
      const db = await settingsClient();
      const { data, error } = await db.auth.signInWithPassword({
        email,
        password,
      });
      setPassword('');
      if (error || !data.user)
        throw new Error(
          'Không đăng nhập được; kiểm tra tài khoản Supabase Auth đã xác nhận email.',
        );
      setMessage('Đã đăng nhập và áp dụng cài đặt của tài khoản.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không đăng nhập được.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      const db = await settingsClient();
      const { error } = await db.auth.signOut();
      if (error) throw new Error('Không đăng xuất được.');
      setDraft(null);
      setMessage('Đã đăng xuất, khôi phục mặc định trên trình duyệt.');
    } catch {
      setMessage('Không đăng xuất được; thử lại.');
    } finally {
      setBusy(false);
    }
  }
  function field(
    key: keyof ScoringSettings,
    label: string,
    min: number,
    max: number,
    step: number,
    percent = false,
  ) {
    return (
      <label key={key}>
        {label}
        <input
          disabled={busy || !initialized}
          required
          type="number"
          min={min}
          max={max}
          step={step}
          value={
            Number.isFinite(settings[key])
              ? percent
                ? Number((settings[key] * 100).toFixed(8))
                : settings[key]
              : ''
          }
          onChange={(e) => {
            const value = e.target.valueAsNumber;
            setSettings({ ...settings, [key]: percent ? value / 100 : value });
          }}
        />
      </label>
    );
  }
  return (
    <section className="settings-panel">
      <span className="eyebrow">CÁ NHÂN HÓA MÔ HÌNH</span>
      <h1>Cài đặt chấm điểm</h1>
      {initialized ? (
        <span data-testid="settings-ready">Cài đặt đã sẵn sàng.</span>
      ) : (
        <p aria-live="polite">Đang đọc cài đặt…</p>
      )}
      <p>
        Các giả định là lựa chọn của bạn, không phải dự báo của doanh nghiệp.
        Điểm thiếu dữ liệu không được tự phân bổ lại trọng số.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="settings-grid">
          {field('grahamWeight', 'Trọng số Graham (%)', 0, 100, 1)}
          {field('buffettWeight', 'Trọng số Buffett (%)', 0, 100, 1)}
          {field('growthRate', 'Tăng trưởng mỗi năm (%)', -20, 20, 0.1, true)}
          {field(
            'discountRate',
            'Tỷ lệ chiết khấu vốn chủ (%)',
            3,
            50,
            0.1,
            true,
          )}
          {field('terminalGrowth', 'Tăng trưởng dài hạn (%)', -5, 5, 0.1, true)}
          {field('projectionYears', 'Số năm dự phóng', 1, 10, 1)}
          {field(
            'maintenanceCapexFraction',
            'Capex duy trì / tổng Capex (%)',
            0,
            100,
            1,
            true,
          )}
        </div>
        <p>
          DCF dùng CFO − Capex × tỷ lệ duy trì, chưa tách dòng tiền CĐ thiểu số.
          Mặc định 100% Capex duy trì là giả định bảo thủ. Đây là proxy cho
          Owner Earnings.
        </p>
        <button disabled={busy || !initialized} type="submit">
          Lưu cài đặt
        </button>
        <button
          disabled={busy || !initialized}
          type="button"
          onClick={() => setSettings({ ...defaultSettings })}
        >
          Khôi phục mặc định
        </button>
      </form>
      <p role="status">{message || authMessage}</p>
      <hr />
      <h2>Lưu cài đặt theo tài khoản</h2>
      {userId ? (
        <>
          <p>
            Đã đăng nhập Supabase. RLS chỉ cho phép truy cập cài đặt của tài
            khoản này.
          </p>
          <button disabled={busy || !initialized} onClick={() => void logout()}>
            Đăng xuất
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <p>
            Dùng tài khoản đã tạo trong Supabase Auth. Khi chưa đăng nhập, cài
            đặt lưu trên trình duyệt.
          </p>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy || !initialized}>Đăng nhập</button>
        </form>
      )}
    </section>
  );
}

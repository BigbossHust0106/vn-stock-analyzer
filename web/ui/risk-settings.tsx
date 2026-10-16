'use client';
import { useState } from 'react';
import { useAuth } from './auth-provider';
import { useAccountRisk } from '../lib/risk-settings';
import { settingsClient } from '../lib/scoring-settings';
import {
  defaultRiskSettings,
  validRiskSettings,
  type RiskSettings,
} from '../../modules/settings/risk-settings';
export function RiskSettingsForm() {
  const { user } = useAuth();
  return <RiskEditor key={user?.id ?? 'pending'} owner={user?.id ?? null} />;
}
function RiskEditor({ owner }: { owner: string | null }) {
  const persisted = useAccountRisk(owner);
  const [draft, setDraft] = useState<RiskSettings | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const value = draft ?? persisted.value;
  async function save() {
    if (!owner || !validRiskSettings(value)) {
      setMessage('Kiểm tra ngưỡng: cắt lỗ/trailing 0,5–30%; ATR 0,5–5.');
      return;
    }
    setBusy(true);
    try {
      const db = await settingsClient();
      const { error } = await db
        .from('user_settings')
        .upsert({ owner_id: owner, risk_preferences: value });
      if (error) throw Error('Save failed');
      setMessage(
        'Đã lưu ngưỡng rủi ro theo tài khoản. Áp dụng khi mở kế hoạch chưa có cài đặt riêng.',
      );
    } catch {
      setMessage('Không lưu được ngưỡng rủi ro; thử lại.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-panel" data-testid="risk-settings">
      <span className="eyebrow">QUẢN TRỊ RỦI RO</span>
      <h2>Ngưỡng cắt lỗ mặc định</h2>
      <p>
        Dùng cho các mã chưa có cài đặt riêng. Không thay đổi vị thế, mức
        trailing stop hoặc cảnh báo đã lưu.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="settings-grid">
          {(
            [
              ['maxLoss', 'Cắt lỗ tối đa (%)', 0.5, 30, 100],
              ['atrMultiple', 'Bội số ATR', 0.5, 5, 1],
              ['trailingPercent', 'Khoảng trailing stop (%)', 0.5, 30, 100],
            ] as const
          ).map(([key, label, min, max, scale]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step="0.5"
                required
                value={
                  Number.isFinite(value[key])
                    ? Number((value[key] * scale).toFixed(4))
                    : ''
                }
                onChange={(e) =>
                  setDraft({ ...value, [key]: e.target.valueAsNumber / scale })
                }
              />
            </label>
          ))}
          <label>
            Phương pháp cắt lỗ
            <select
              aria-label="Phương pháp cắt lỗ"
              value={value.stopMethod}
              onChange={(e) =>
                setDraft({
                  ...value,
                  stopMethod: e.target.value as RiskSettings['stopMethod'],
                })
              }
            >
              <option value="atr">ATR</option>
              <option value="swing">Đáy gần nhất</option>
              <option value="percent">Phần trăm tối đa</option>
            </select>
          </label>
        </div>
        <button disabled={busy || !persisted.ready}>Lưu ngưỡng rủi ro</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDraft({ ...defaultRiskSettings })}
        >
          Dùng ngưỡng mặc định
        </button>
      </form>
      <p role="status">{message || persisted.message}</p>
    </section>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import {
  marketJson,
  stockDetail,
  type StockDetail,
} from '../lib/market-client';
import type { ScoreReport } from '../../modules/scoring/engine';
import { useScoringSettings } from '../lib/scoring-settings';
import {
  auditTargets,
  auditPrompt,
  collectStockExport,
  type AuditTarget,
} from '../lib/stock-export';

export function StockExport({
  detail,
  assessment,
}: {
  detail: StockDetail;
  assessment: ScoreReport | null;
}) {
  const settings = useScoringSettings();
  const [target, setTarget] = useState<AuditTarget | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function prepare(next: AuditTarget) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setTarget(next);
    setText('');
    setMessage('');
    setBusy(true);
    dialog.current?.showModal();
    try {
      const snapshot = await collectStockExport(
        detail,
        settings,
        AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]),
        marketJson,
        (signal) => stockDetail(detail.stock.symbol, signal, 'history'),
        new Date().toISOString(),
        assessment,
      );
      if (!abort.signal.aborted) {
        setText(auditPrompt(snapshot));
        const missing = snapshot.resources.filter(
          (r) => r.status === 'unavailable',
        );
        setMessage(
          missing.length
            ? 'Một số nguồn không tải được: ' +
                missing.map((r) => r.key).join(', ') +
                '. Đã ghi rõ trong bản xuất.'
            : 'Đã chuẩn bị đầy đủ các nhóm dữ liệu API hiện cung cấp.',
        );
      }
    } catch {
      if (!abort.signal.aborted)
        setMessage('Không chuẩn bị được bản xuất. Hãy đóng và thử lại.');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function close() {
    controller.current?.abort();
    dialog.current?.close();
    setTarget(null);
    setText('');
    setBusy(false);
  }
  async function copy(open: boolean) {
    if (!target || !text) return;
    try {
      // Copy must succeed before opening the AI tab. No data in URL or POST.
      await navigator.clipboard.writeText(text);
      setMessage(
        'Đã sao chép. Dán vào cuộc trò chuyện AI (Ctrl+V hoặc Dán). Nếu quá dài, đính kèm file .txt bên dưới.',
      );
      if (open) {
        const tab = window.open(
          auditTargets[target].url,
          '_blank',
          'noopener,noreferrer',
        );
        // With noopener browsers may return null even after a successful open.
        void tab;
      }
    } catch {
      output.current?.focus();
      output.current?.select();
      setMessage(
        'Trình duyệt không cho sao chép tự động. Hãy sao chép ô đã chọn hoặc tải file, rồi bấm liên kết mở AI bên dưới.',
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = detail.stock.symbol + '-kiem-chung.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="stock-export" aria-label="Xuất dữ liệu kiểm chứng">
      <div className="export-actions">
        <button type="button" onClick={() => void prepare('chatgpt')}>
          Kiểm chứng bằng ChatGPT ↗
        </button>
        <button type="button" onClick={() => void prepare('claude')}>
          Kiểm chứng bằng Claude ↗
        </button>
      </div>
      <small>
        Xuất số liệu, đánh giá, giải thích từng tiêu chí, rủi ro và phân tích
        tin tức kèm nguồn. Xem trước rồi sao chép/dán vào AI.
      </small>
      <dialog
        ref={dialog}
        className="stock-export-dialog"
        onCancel={close}
        aria-labelledby="export-title"
      >
        <div className="detail-heading">
          <h2 id="export-title">
            Kiểm chứng {detail.stock.symbol} với{' '}
            {target && auditTargets[target].label}
          </h2>
          <button type="button" onClick={close} aria-label="Đóng bản xuất">
            ✕
          </button>
        </div>
        <p>
          Dữ liệu công khai và tham số mô hình sẽ được sao chép khi bạn bấm nút
          bên dưới. Sau đó dán vào AI. Không kèm tài khoản hay watchlist; AI có
          thể sai, không thay thế đối chiếu báo cáo gốc.
        </p>
        {busy && <p role="status">Đang gom dữ liệu và nguồn…</p>}
        <p role="status">{message}</p>
        {!!text && (
          <>
            <label htmlFor="stock-export-output">
              Toàn bộ dữ liệu & yêu cầu kiểm chứng ·{' '}
              {text.length.toLocaleString('vi-VN')} ký tự
            </label>
            <textarea
              ref={output}
              id="stock-export-output"
              readOnly
              value={text}
              spellCheck={false}
            />
            <div className="export-actions">
              <button type="button" onClick={() => void copy(true)}>
                Sao chép & mở {target && auditTargets[target].label} ↗
              </button>
              <button type="button" onClick={() => void copy(false)}>
                Sao chép
              </button>
              <button type="button" onClick={download}>
                Tải file .txt
              </button>
              {target && (
                <a
                  href={auditTargets[target].url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở {auditTargets[target].label} ↗
                </a>
              )}
            </div>
            <p>
              Không tự gửi tin nhắn vào AI. Nếu bị chặn cửa sổ mới, dùng liên
              kết “Mở” phía trên. Với gói dài, tải file rồi đính kèm; giới hạn
              tùy tài khoản AI.
            </p>
          </>
        )}
      </dialog>
    </section>
  );
}

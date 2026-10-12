import { describe, expect, it, vi } from 'vitest';
import worker, { ingest } from '../../worker/src/index';
import { canIngest, vietnamDate } from '../../modules/market/calendar';

describe('Worker và lịch giao dịch Việt Nam', () => {
  it('GET /health trả hello world; sai route/method trả 404/405', async () => {
    const response = await worker.fetch(
      new Request('https://example.test/health'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      message: 'Xin chào từ Workers API',
    });
    expect(
      (await worker.fetch(new Request('https://example.test/no-route'))).status,
    ).toBe(404);
    expect(
      (
        await worker.fetch(
          new Request('https://example.test/health', { method: 'POST' }),
        )
      ).status,
    ).toBe(405);
  });
  it('Ngày UTC→VN, trước đóng cửa, nghỉ lễ, phiên thiếu lịch', () => {
    expect(vietnamDate(Date.parse('2026-04-30T18:00:00Z'))).toBe('2026-05-01');
    const time = Date.parse('2026-04-30T08:30:00Z');
    expect(canIngest(null, time)).toBe(false);
    expect(
      canIngest(
        { session_date: '2026-04-30', is_open: false, closes_at: null },
        time,
      ),
    ).toBe(false);
    expect(
      canIngest(
        {
          session_date: '2026-04-30',
          is_open: true,
          closes_at: '2026-04-30T09:00:00Z',
        },
        time,
      ),
    ).toBe(false);
    expect(
      canIngest(
        {
          session_date: '2026-04-30',
          is_open: true,
          closes_at: '2026-04-30T08:00:00Z',
        },
        time,
      ),
    ).toBe(true);
    expect(
      canIngest(
        {
          session_date: '2026-04-29',
          is_open: true,
          closes_at: '2026-04-29T08:00:00Z',
        },
        time,
      ),
    ).toBe(false);
    expect(
      canIngest(
        { session_date: '2026-04-30', is_open: true, closes_at: 'invalid' },
        time,
      ),
    ).toBe(false);
  });
  it('Cron không chạy được khi thiếu cấu hình; lỗi không lộ credential', async () => {
    await expect(ingest({}, Date.now())).rejects.toThrow(
      'Thiếu cấu hình Supabase',
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let task: Promise<unknown> | undefined;
    worker.scheduled(
      { scheduledTime: Date.now(), cron: '30 8 * * 1-5', noRetry: () => {} },
      {},
      {
        waitUntil: (promise) => {
          task = promise;
        },
      },
    );
    await expect(task).rejects.toThrow('Cron ingest thất bại');
    expect(error).toHaveBeenCalledWith(
      'Cron ingest thất bại; kiểm tra cấu hình, lịch và nguồn dữ liệu',
    );
    error.mockRestore();
  });
});

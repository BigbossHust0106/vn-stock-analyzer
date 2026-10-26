import { expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../../worker/src/index';
import {
  financialData,
  parseKbsReport,
  type ReportType,
} from '../../modules/providers/financial-schema';
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'local-test-public',
};
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const now = new Date().toISOString();
  const reports = Object.fromEntries(
    (['KQKD', 'CDKT', 'LCTT', 'CSTC'] as const).map((t) => [
      t,
      parseKbsReport(
        JSON.parse(readFileSync(`fixtures/phase3/VNM-${t}-1.json`, 'utf8')),
        t,
        now,
      ),
    ]),
  ) as Record<ReportType, ReturnType<typeof parseKbsReport>>;
  return financialData(
    'VNM',
    reports,
    JSON.parse(readFileSync('fixtures/phase3/VNM-vci-ratios.json', 'utf8')),
    now,
  );
}
it('BCTC API validate ticker và không mở quyền ghi', async () => {
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  for (const path of ['/v1/financials/VNM%27', '/v1/financials/VNM/extra'])
    expect(
      (await worker.fetch(new Request('https://example.test' + path), env))
        .status,
    ).toBe(400);
  expect(
    (
      await worker.fetch(
        new Request('https://example.test/v1/financials/VNM', {
          method: 'POST',
        }),
        env,
      )
    ).status,
  ).toBe(405);
  expect(transport).not.toHaveBeenCalled();
});
it('Không gọi provider cho mã không có trong catalog, không dùng service key để đọc', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json(null));
  vi.stubGlobal('fetch', transport);
  expect(
    (
      await worker.fetch(
        new Request('https://example.test/v1/financials/ZZZ'),
        { ...env, SUPABASE_SERVICE_ROLE_KEY: 'private-fixture-only' },
      )
    ).status,
  ).toBe(404);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(new Headers(transport.mock.calls[0]![1]?.headers).get('apikey')).toBe(
    'local-test-public',
  );
});
it('Đọc BCTC public đã lưu, báo điểm thật theo cùng snapshot, không có private key trong response', async () => {
  const f = fixture(),
    calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const u = String(input);
      calls.push(u);
      if (u.includes('/stocks?')) return Response.json({ id: 'id-vnm' });
      if (u.includes('/financial_snapshots?'))
        return Response.json({ payload: f, fetched_at: f.fetchedAt });
      if (u.includes('/financial_report_backups?')) return Response.json([]);
      if (u.includes('/prices_current?'))
        return Response.json({
          last_price_vnd: 57700,
          fetched_at: f.fetchedAt,
        });
      throw new Error('Unexpected external provider');
    }),
  );
  const waitUntil = vi.fn();
  const response = await worker.fetch(
    new Request('https://example.test/v1/financials/VNM'),
    { ...env, SUPABASE_SERVICE_ROLE_KEY: 'must-not-write-on-read' },
    { waitUntil },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    financials: { annual: unknown[] };
    report: {
      strategies: { name: string; score: number }[];
      conclusion: string;
    };
  };
  expect(body.financials.annual).toHaveLength(4);
  expect(body.report.strategies.map((s) => s.name)).toEqual([
    'Benjamin Graham',
    'Warren Buffett',
  ]);
  expect(body.report.conclusion).toBe('Quan sát');
  expect(JSON.stringify(body)).not.toContain('local-test-public');
  expect(calls).toHaveLength(4);
  expect(waitUntil).not.toHaveBeenCalled();
});
it('Không đọc được migration: trả lỗi rõ, không fabricate report', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/stocks?')
        ? Response.json({ id: 'id-vnm' })
        : Response.json({ code: 'PGRST205' }, { status: 404 }),
    ),
  );
  const response = await worker.fetch(
    new Request('https://example.test/v1/financials/VNM'),
    env,
  );
  expect(response.status).toBe(502);
  expect(await response.text()).toContain('migration/provider');
});

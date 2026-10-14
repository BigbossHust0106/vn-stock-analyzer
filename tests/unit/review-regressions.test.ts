import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  financialData,
  parseKbsReport,
  type ReportType,
} from '../../modules/providers/financial-schema';
import { buffett } from '../../modules/strategies/buffett';
import { scoreStock } from '../../modules/scoring/engine';
import { defaultSettings } from '../../modules/settings/scoring-settings';
import { financialRegression } from '../../modules/providers/financial-types';
import { persistFinancials } from '../../worker/src/financial-sync';
import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const now = '2026-10-14T09:00:00Z';
export function vnmFinancials() {
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
  return {
    reports,
    ratios: JSON.parse(
      readFileSync('fixtures/phase3/VNM-vci-ratios.json', 'utf8'),
    ) as unknown,
  };
}
it('Review1: VNM CFO hợp nhất không phải dòng tiền mẹ; dù giá thấp, DCF phải unknown', () => {
  const { reports, ratios } = vnmFinancials();
  const f = financialData('VNM', reports, ratios, now);
  const r = buffett(f, 20000, now, defaultSettings);
  expect(r.criteria.find((c) => c.id === 'dcf')!.status).toBe('unknown');
  expect(r.intrinsicVnd).toEqual({ ok: false, reason: 'không đủ dữ liệu' });
});
it('Review2: thiếu CSTC giữ4 năm BCTC và EPS4028, không tự điền ROE', () => {
  const { reports, ratios } = vnmFinancials();
  const f = financialData('VNM', { ...reports, CSTC: [] }, ratios, now);
  expect(f.annual).toHaveLength(4);
  expect(f.annual.at(-1)!.epsAnnualVnd).toBe(4028);
  expect(f.annual.at(-1)!.roe).toBeNull();
});
it('Review2: không thay snapshot tốt bằng rỗng/thiếu ratio; nguồn đầy đủ mới được nhận', () => {
  const { reports, ratios } = vnmFinancials();
  const good = financialData('VNM', reports, ratios, now);
  const partial = financialData('VNM', { ...reports, CSTC: [] }, ratios, now);
  expect(financialRegression(good, { ...good, annual: [] })).toBe(true);
  expect(financialRegression(good, partial)).toBe(true);
  expect(financialRegression(null, partial)).toBe(false);
  expect(financialRegression(good, good)).toBe(false);
});
it('Review5: client gửi một RPC chung với quote version; lỗi không gọi một write khác', async () => {
  const { reports, ratios } = vnmFinancials();
  const good = financialData('VNM', reports, ratios, now);
  const report = scoreStock(good, 20000, now, defaultSettings, now);
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const db = { rpc } as unknown as SupabaseClient;
  await persistFinancials(db, 'stock-id', good, report, 'quote-version');
  expect(rpc.mock.calls).toEqual([
    [
      'persist_financial_score',
      {
        dataset: good,
        score_record: expect.objectContaining({
          stock_id: 'stock-id',
          quote_version: 'quote-version',
          inputs_as_of: now,
          explanation: report,
        }),
      },
    ],
  ]);
  rpc.mockClear().mockResolvedValue({ error: { message: 'score rejected' } });
  await expect(
    persistFinancials(db, 'stock-id', good, report, 'quote-version'),
  ).rejects.toThrow('nguyên tử');
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('Review4: tải lại hôm nay không chứng minh timestamp nguồn mới', () => {
  const { reports, ratios } = vnmFinancials();
  const f = financialData('VNM', reports, ratios, now);
  const r = scoreStock(f, 20000, now, defaultSettings, now);
  expect(r.risks.some((s) => s.includes('timestamp nguồn'))).toBe(true);
});
it('Review9: currentShares=null là thiếu bằng chứng, không phải thay đổi đã xác minh', () => {
  const { reports, ratios } = vnmFinancials();
  const f = financialData('VNM', reports, ratios, now);
  const r = scoreStock({ ...f, currentShares: null }, 20000, now);
  expect(r.risks.join()).not.toContain('Số cổ phiếu thay đổi');
  expect(r.risks.join()).toContain('Thiếu số cổ phiếu');
});

it('Review1: kịch bản VNM giữ đáp án độc lập38.079,86 nhưng không cấp điểm/MOS nội tại', () => {
  const { reports, ratios } = vnmFinancials();
  const r = buffett(
    financialData('VNM', reports, ratios, now),
    20000,
    now,
    defaultSettings,
  );
  // CFO8668137049000−Capex1762010725000=6906126324000; r=.12,g=.05,tg=.02,N5,CP2089955445 =>38079.86 VND/CP.
  expect(r.scenario.valueVnd.ok && r.scenario.valueVnd.value).toBeCloseTo(
    38079.86,
    2,
  );
  expect(r.marginOfSafety).toEqual({ ok: false, reason: 'không đủ dữ liệu' });
  expect(r.scenario.usableForScoring).toBe(false);
});

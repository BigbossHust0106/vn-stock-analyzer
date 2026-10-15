import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  parseBackupStatement,
  VietcapReportsProvider,
} from '../../modules/providers/financial-backup';
import { isFinancialData } from '../../modules/providers/financial-types';
import { defaultHttpOptions } from '../../modules/providers/http';
const raw = (name: string) =>
  JSON.parse(readFileSync('fixtures/phase3/VNM-vci-' + name + '.json', 'utf8'));
it('real Vietcap fixture: eight annual periods, EPS2025 raw4028 stays raw, no inferred audit status', () => {
  const rows = parseBackupStatement(raw('income'), 'VNM');
  expect(rows.map((r) => r.year)).toEqual([
    2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
  ]);
  expect(rows.at(-1)?.fields.isa23).toBe(4028); // Fixture provider annual EPS. No x1000 or quarterly annualization.
  expect(rows.at(-1)?.publicDate).toBe('2026-03-02');
  expect(rows.at(-1)).not.toHaveProperty('audited');
});
it('wrong ticker, duplicate year, missing statement and numeric string are rejected', () => {
  expect(() => parseBackupStatement(raw('income'), 'FPT')).toThrow('sai mã');
  const d = raw('income');
  d.data.years.push(d.data.years[0]);
  expect(() => parseBackupStatement(d, 'VNM')).toThrow('trùng kỳ');
  expect(() => parseBackupStatement({}, 'VNM')).toThrow('data.years');
  const n = raw('income');
  n.data.years[0].isa23 = '4028';
  expect(() => parseBackupStatement(n, 'VNM')).toThrow('sai kiểu');
});
it('adapter validates three sections and cache isolates callers; never enables scoring or emits a partial backup', async () => {
  const f = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      raw(
        String(input).includes('BALANCE_SHEET')
          ? 'balance'
          : String(input).includes('INCOME_STATEMENT')
            ? 'income'
            : 'cash',
      ),
    ),
  );
  const p = new VietcapReportsProvider(f, {
    ...defaultHttpOptions,
    minIntervalMs: 0,
    retries: 0,
  });
  const d = await p.fetchFinancialReports('VNM');
  expect(d.usableForScoring).toBe(false);
  expect(isFinancialData(d)).toBe(false);
  expect(d.verification).toBe('raw_provider_only');
  d.reports.INCOME_STATEMENT[0]!.fields.isa23 = 0;
  expect(
    (await p.fetchFinancialReports('VNM')).reports.INCOME_STATEMENT[0]?.fields
      .isa23,
  ).toBe(5295);
  expect(f).toHaveBeenCalledTimes(3);
  const bad = new VietcapReportsProvider(
    async () =>
      Response.json({ successful: true, status: 200, data: { years: [] } }),
    { ...defaultHttpOptions, minIntervalMs: 0, retries: 0 },
  );
  await expect(bad.fetchFinancialReports('VNM')).rejects.toThrow('rỗng');
  expect(() => p.fetchFinancialReports('../bad')).toThrow();
});

import { describe, expect, it } from 'vitest';
import acbKbs from '../../fixtures/source-research/2026-10-13/kbs-ohlc.json';
import acbVci from '../../fixtures/source-research/2026-10-13/vci-ohlc.json';
import fptKbs from '../../fixtures/source-research/2026-10-13/kbs-FPT.json';
import fptVci from '../../fixtures/source-research/2026-10-13/vci-FPT.json';
import shsKbs from '../../fixtures/source-research/2026-10-13/kbs-SHS.json';
import shsVci from '../../fixtures/source-research/2026-10-13/vci-SHS.json';
import qnsKbs from '../../fixtures/source-research/2026-10-13/kbs-QNS.json';
import qnsVci from '../../fixtures/source-research/2026-10-13/vci-QNS.json';
import ssiUnauthorized from '../../fixtures/source-research/2026-10-13/ssi-ohlc.json';
import {
  compareDailyEvidence,
  parseKbsDailyEvidence,
  parseVietcapDailyEvidence,
} from '../../modules/providers/source-evidence';
const day = '2026-10-12';
describe('API research — phản hồi thật, không dùng để ingest production', () => {
  it('ACB khớp số đối chiếu độc lập của người dùng, giá VND, tổng 7.969.100', () => {
    const kbs = parseKbsDailyEvidence(acbKbs, 'ACB')[0]!;
    const vci = parseVietcapDailyEvidence(acbVci, 'ACB').find(
      (b) => b.sessionDate === day,
    )!;
    // Chart ACB do người dùng cung cấp: O20.20 H20.55 L20.15 C20.45, nghìn VND.
    expect(kbs).toMatchObject({
      sessionDate: day,
      openVnd: 20200,
      highVnd: 20550,
      lowVnd: 20150,
      closeVnd: 20450,
      volumeReported: 7969100,
      priceBasis: 'unverified',
      volumeDefinition: 'unverified',
    });
    expect(compareDailyEvidence(kbs, vci)).toEqual({
      pricesMatch: true,
      volumeMatch: true,
      volumeDifference: 0,
    });
  });
  it.each([
    ['FPT', fptKbs, fptVci],
    ['QNS', qnsKbs, qnsVci],
  ] as const)(
    '%s hai nguồn khớp OHLC và volume ngày khảo sát',
    (symbol, kbs, vci) => {
      const a = parseKbsDailyEvidence(kbs, symbol)[0]!;
      const b = parseVietcapDailyEvidence(vci, symbol).find(
        (bar) => bar.sessionDate === day,
      )!;
      expect(compareDailyEvidence(a, b)).toEqual({
        pricesMatch: true,
        volumeMatch: true,
        volumeDifference: 0,
      });
    },
  );
  it('SHS phải phát hiện volume lệch, không sửa fixture để cho hai nguồn khớp', () => {
    const a = parseKbsDailyEvidence(shsKbs, 'SHS')[0]!;
    const b = parseVietcapDailyEvidence(shsVci, 'SHS').find(
      (bar) => bar.sessionDate === day,
    )!;
    // Raw thật: 4,055,903 - 4,050,300 = 5,603. Chưa xác minh nguyên nhân.
    expect(a.volumeReported).toBe(4050300);
    expect(b.volumeReported).toBe(4055903);
    expect(compareDailyEvidence(a, b)).toEqual({
      pricesMatch: true,
      volumeMatch: false,
      volumeDifference: 5603,
    });
  });
  it('HTTP200 với JSON status401 SSI không phải dữ liệu thành công', () => {
    expect(ssiUnauthorized).toEqual({
      message: 'Missing Authorization header',
      status: 401,
    });
    expect(() => parseKbsDailyEvidence(ssiUnauthorized, 'ACB')).toThrow();
    expect(() => parseVietcapDailyEvidence(ssiUnauthorized, 'ACB')).toThrow();
  });
  it('Chặn thiếu field, sai mã, OHLC sai, timestamp sai, volume âm/NaN, trùng ngày', () => {
    for (const payload of [
      null,
      {},
      [],
      { ...acbKbs, symbol: 'FPT' },
      { symbol: 'ACB', data_day: [] },
    ])
      expect(() => parseKbsDailyEvidence(payload, 'ACB')).toThrow();
    for (const [key, value] of [
      ['t', '2026-02-30 07:00'],
      ['o', null],
      ['c', NaN],
      ['h', 1],
      ['v', -1],
      ['v', 1.5],
    ] as const)
      expect(() =>
        parseKbsDailyEvidence(
          {
            symbol: 'ACB',
            data_day: [{ ...acbKbs.data_day[0], [key]: value }],
          },
          'ACB',
        ),
      ).toThrow();
    expect(() =>
      parseKbsDailyEvidence(
        { symbol: 'ACB', data_day: [acbKbs.data_day[0], acbKbs.data_day[0]] },
        'ACB',
      ),
    ).toThrow('trùng');
    expect(() =>
      parseVietcapDailyEvidence([{ ...acbVci[0], v: [] }], 'ACB'),
    ).toThrow('lệch');
    expect(() =>
      parseVietcapDailyEvidence([{ ...acbVci[0], t: ['NaN'] }], 'ACB'),
    ).toThrow();
    expect(() => parseVietcapDailyEvidence(acbVci, 'FPT')).toThrow('thiếu');
    const a = parseKbsDailyEvidence(acbKbs, 'ACB')[0]!;
    expect(() =>
      compareDailyEvidence(a, { ...a, sessionDate: '2026-10-13' }),
    ).toThrow('khác');
  });
});

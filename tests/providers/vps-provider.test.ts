import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/vps-getliststockdata-sample.json';
import {
  parseVpsPayload,
  VpsProvider,
  VPS_ENDPOINT,
} from '../../modules/providers/vps-provider';
import {
  parseBookLevel,
  validateVpsResponse,
  vpsFieldTypes,
} from '../../modules/providers/vps-schema';
const fetchedAt = '2026-10-12T08:30:00Z'; // Thời điểm máy lấy fixture giả lập; không phải thời điểm phiên của mẫu.
const opts = {
  ttlMs: 60_000,
  minIntervalMs: 0,
  retries: 2,
  retryDelayMs: 0,
  timeoutMs: 1000,
};
const acb = fixture[0]!;
const response = () => Response.json([acb]);
describe('VpsProvider — fixture thật do người dùng cung cấp', () => {
  it('Kiểm tra toàn bộ 30 bản ghi và TẤT CẢ 57 trường', () => {
    expect(validateVpsResponse(fixture)).toHaveLength(30);
    expect(Object.keys(vpsFieldTypes)).toHaveLength(57);
    for (const row of fixture)
      expect(Object.keys(row).sort()).toEqual(
        Object.keys(vpsFieldTypes).sort(),
      );
  });
  it('ACB đối chiếu bảng giá: r=20.15,c=21.55,f=18.75,g3 price=20.35 (nghìn VND)', () => {
    // Đáp án do người dùng xác nhận, không được sửa để khớp parser.
    const parsed = parseVpsPayload(fixture, fetchedAt).find(
      (q) => q.symbol === 'ACB',
    )!;
    expect(parsed.referenceVnd).toBe(20150);
    expect(parsed.ceilingVnd).toBe(21550);
    expect(parsed.floorVnd).toBe(18750);
    expect(parsed.bid3PriceVnd).toBe(20350);
    expect(parseBookLevel(acb.g3, 'g3')).toEqual({
      priceVnd: 20350,
      volumeRaw: 17200,
      markerRaw: 'i',
    });
    expect(parsed.volumeRaw).toEqual({
      lastVolume: 1440,
      lot: 796910,
      lastVolumeUnit: 'unverified',
      lotUnit: 'lot_of_10_shares',
    });
    expect(parsed.lastPriceVnd).toBe(20450); // ACB C=20.45 được người dùng đối chiếu chart 12/10/2026.
    expect(parsed.priceBasis).toBe('unverified');
    expect(parsed.exchangeTimestamp).toBeNull();
    expect(parsed.semantics.lastPrice).toBe('verified_on_acb_one_day');
    // closePrice = 20150.0; không nhân 1000 như r, không dùng như close lịch sử.
    expect(Number(acb.closePrice)).toBe(20150);
    expect(Number(acb.closePrice)).toBe(acb.r * 1000);
  });
  it('lot ACB 796910 × VPS_LOT_SIZE 10 = 7.969.100 cổ phiếu', () => {
    // Người dùng đối chiếu ACB 12/10/2026: chart VPS hiển thị 7,969 M.
    const acbQuote = parseVpsPayload(fixture, fetchedAt)[0]!;
    expect(acbQuote.totalVolumeShares).toBe(7969100);
    expect(acbQuote.volumeVerificationScope).toBe('ACB_2026-10-12_only');
    expect(acbQuote.volumeRaw.lastVolume).toBe(1440);
  });
  it.todo(
    'lastVolume=1440: cần số đối chiếu khối lượng khớp cuối; chưa chuẩn hóa, không dùng scoring/rankings',
  );
  it('Mỗi trường thiếu/sai kiểu đều báo đúng đường dẫn', () => {
    for (const [field, type] of Object.entries(vpsFieldTypes)) {
      const missing: Record<string, unknown> = { ...acb };
      delete missing[field];
      expect(() => validateVpsResponse([missing])).toThrow(
        `$[0].${field}: thiếu trường`,
      );
      const invalid = {
        ...acb,
        [field]: type === 'null' ? {} : type === 'string' ? 1 : 'bad',
      };
      expect(() => validateVpsResponse([invalid])).toThrow(
        `$[0].${field}: cần ${type}`,
      );
    }
  });
  it('Không ép null, sai giá, tràn số, NaN, chuỗi rỗng; chấp nhận scientific và fRoom âm trong mẫu', () => {
    expect(
      validateVpsResponse(fixture).find((r) => r.sym === 'GVR')!.fRoom,
    ).toBe('-2272899.60');
    for (const payload of [null, {}, [], [null]])
      expect(() => validateVpsResponse(payload)).toThrow();
    for (const [key, value] of [
      ['r', 0],
      ['c', NaN],
      ['c', Infinity],
      ['f', 25],
      ['lastPrice', -1],
      ['lastPrice', Number.MAX_VALUE],
      ['lot', 1.5],
      ['lot', Number.MAX_SAFE_INTEGER],
      ['sym', '<script>'],
      ['fBValue', ''],
      ['fRoom', 'NaN'],
      ['g3', '20.35|1.5|i'],
      ['g3', '20.35|1'],
      ['g3', '1e309|1|i'],
    ] as const)
      expect(() => validateVpsResponse([{ ...acb, [key]: value }])).toThrow();
    expect(() => validateVpsResponse([acb, acb])).toThrow('trùng');
    expect(() => parseVpsPayload(fixture, 'invalid')).toThrow('fetchedAt');
    expect(
      parseVpsPayload([{ ...acb, lastPrice: 0, g3: '0|0|e' }], fetchedAt)[0],
    ).toMatchObject({ lastPriceVnd: null, bid3PriceVnd: null });
  });
  it('Batch mã, cache, serialize và không mutate cache', async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(fixture.slice(0, 2)));
    const provider = new VpsProvider(mock, opts);
    const [a, b] = await Promise.all([
      provider.fetchQuotes(['BID', 'ACB']),
      provider.fetchQuotes(['ACB', 'BID', 'ACB']),
    ]);
    a[0]!.referenceVnd = 1;
    expect(b[0]!.referenceVnd).toBe(20150);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]![0]).toBe(VPS_ENDPOINT + 'ACB,BID');
  });
  it('Retry 429/503 và network; không retry 401/403; không lộ response body', async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(response());
    expect(
      (await new VpsProvider(mock, opts).fetchQuotes(['ACB']))[0]!.symbol,
    ).toBe('ACB');
    expect(mock).toHaveBeenCalledTimes(3);
    for (const status of [401, 403]) {
      const denied = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private response', { status }));
      await expect(
        new VpsProvider(denied, opts).fetchQuotes(['ACB']),
      ).rejects.toThrow(`VPS HTTP ${status}`);
      expect(denied).toHaveBeenCalledTimes(1);
    }
    const network = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('secret in transport exception'));
    await expect(
      new VpsProvider(network, opts).fetchQuotes(['ACB']),
    ).rejects.toThrow('Không kết nối được VPS');
    expect(network).toHaveBeenCalledTimes(3);
  });
  it('Cache expiry, retry limit và danh sách sai/thiếu/trả dư mã', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    const provider = new VpsProvider(transport, {
      ...opts,
      ttlMs: 0,
      minIntervalMs: 1,
    });
    await provider.fetchQuotes(['ACB']);
    await provider.fetchQuotes(['ACB']);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const symbols of [
      [],
      ['aCB'],
      ['ACB/../'],
      Array.from({ length: 51 }, () => 'ACB'),
    ])
      await expect(provider.fetchQuotes(symbols)).rejects.toThrow('1–50');
    await expect(provider.fetchQuotes(['BID'])).rejects.toThrow('thiếu mã');
    expect(() => new VpsProvider(transport, { ...opts, retries: 6 })).toThrow();
    const wait = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
      );
    await expect(
      new VpsProvider(wait, opts).fetchQuotes(['ACB']),
    ).rejects.toThrow('job sau');
  });
});

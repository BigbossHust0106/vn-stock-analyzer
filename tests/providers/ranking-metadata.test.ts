import { expect, it } from 'vitest';
import {
  parseSectors,
  parseSectorStocks,
  parseCorporateEvents,
} from '../../modules/providers/ranking-metadata';
import sectors from '../../fixtures/phase4/kbs-sectors.json';
import members from '../../fixtures/phase4/kbs-sectorstocks.json';
import events from '../../fixtures/phase4/vci-vnm-events.json';
it('Payload thật phân ngành KBS giữ tên tiếng Việt và mã VNM, không gọi là ICB', () => {
  expect(parseSectors(sectors).find((s) => s.code === 19)?.name).toBe(
    'Thực phẩm - Đồ uống',
  );
  expect(parseSectorStocks(members, 'Thực phẩm - Đồ uống')).toContain('VNM');
  expect(() => parseSectors([])).toThrow();
  expect(() => parseSectorStocks(members, 'Sai ngành')).toThrow();
});
it('Sự kiện thật VNM: cổ tức dùng ngày GDKHQ, ĐHĐCĐ dùng issueDate; không dùng publicDate làm ngày sự kiện', () => {
  const rows = parseCorporateEvents(
    events,
    'VNM',
    'https://iq.vietcap.com.vn/',
    '2026-10-14T00:00:00Z',
  );
  expect(rows.map((r) => [r.kind, r.event_date])).toEqual([
    ['dividend', '2026-06-26'],
    ['agm', '2026-04-22'],
  ]);
  expect(rows[0]!.known_at).toBe('2026-06-19T00:00:00+07:00');
  expect(
    parseCorporateEvents(
      events,
      'VNM',
      'https://iq.vietcap.com.vn/',
      '2026-01-01T00:00:00Z',
    ),
  ).toHaveLength(0);
  expect(() =>
    parseCorporateEvents(
      events,
      'FPT',
      'https://iq.vietcap.com.vn/',
      '2026-10-14T00:00:00Z',
    ),
  ).toThrow();
  expect(() =>
    parseCorporateEvents(
      { successful: false },
      'VNM',
      'https://iq.vietcap.com.vn/',
      '2026-10-14T00:00:00Z',
    ),
  ).toThrow();
});

it('Giá tham chiếu KBS VND50800 cho QNS; không đổi thành nghìn hay dùng làm quote giao dịch', async () => {
  const { parseReferencePrices } =
    await import('../../modules/providers/ranking-metadata');
  const { default: catalog } =
    await import('../../fixtures/phase2/kbs-catalog.json');
  expect(
    parseReferencePrices(catalog).find((r) => r.symbol === 'QNS')
      ?.reference_vnd,
  ).toBe(50800);
  expect(() => parseReferencePrices([])).toThrow('không đầy đủ');
});

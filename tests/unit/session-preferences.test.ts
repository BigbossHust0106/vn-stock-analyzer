import { expect, it } from 'vitest';
import { SessionPreferences } from '../../modules/settings/session-preferences';
import { defaultSettings } from '../../modules/settings/scoring-settings';
it('Review6: owner lưu trên disk không cho phép đọc settings người khác; expiry/signout sang guest', () => {
  const map = new Map([
    ['vn-stock-scoring-owner', 'A'],
    [
      'vn-stock-scoring-v1:A',
      JSON.stringify({
        ...defaultSettings,
        grahamWeight: 70,
        buffettWeight: 30,
      }),
    ],
  ]);
  let now = 100;
  const store = new SessionPreferences(
    {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    },
    () => {},
    () => now,
  );
  expect(store.read().grahamWeight).toBe(50);
  store.activate('A', 200);
  expect(store.read().grahamWeight).toBe(70);
  now = 201;
  expect(store.ownerId()).toBeNull();
  expect(store.read().grahamWeight).toBe(50);
  store.activate('A', 300);
  store.activate(null, null);
  expect(store.read().grahamWeight).toBe(50);
});
it('Review6: request A về muộn sau logout/login B không áp dụng preferences A', () => {
  const map = new Map<string, string>(),
    store = new SessionPreferences(
      {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => {
          map.set(k, v);
        },
      },
      () => {},
      () => 100,
    );
  store.activate('A', 200);
  const request = store.capture();
  store.activate('B', 200);
  expect(
    store.accept(
      { ...defaultSettings, grahamWeight: 100, buffettWeight: 0 },
      request,
    ),
  ).toBe(false);
  expect(store.read()).toEqual(defaultSettings);
  expect(() => store.write(defaultSettings, 'A')).toThrow('Phiên đăng nhập');
  store.write(defaultSettings, 'B');
});
it('Review6: hai tab dùng cùng storage nhưng owner theo Auth; ghi mới chặn response cloud cũ', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  const a = new SessionPreferences(
    storage,
    () => {},
    () => 100,
  );
  const b = new SessionPreferences(
    storage,
    () => {},
    () => 100,
  );
  a.activate('A', 200);
  b.activate('A', 200);
  const oldCloud = b.capture();
  a.write({ ...defaultSettings, grahamWeight: 70, buffettWeight: 30 }, 'A');
  expect(b.read().grahamWeight).toBe(70);
  b.write({ ...defaultSettings, grahamWeight: 100, buffettWeight: 0 }, 'A');
  expect(b.accept(defaultSettings, oldCloud)).toBe(false);
  // Auth signout is delivered to both tabs; disk owner IDs do not restore A.
  a.activate(null, null);
  b.activate(null, null);
  expect(a.read().grahamWeight).toBe(50);
  expect(b.read().grahamWeight).toBe(50);
});

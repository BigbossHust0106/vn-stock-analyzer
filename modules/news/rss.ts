import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { NewsSource } from './sources';
export interface RssArticle {
  id: string;
  source_id: string;
  source_url: string;
  title: string;
  excerpt: string;
  published_at: string;
  fetched_at: string;
  fingerprint: string;
}
export function plainText(value: unknown) {
  if (typeof value !== 'string') return '';
  let decoded = value;
  for (let pass = 0; pass < 2; pass++)
    decoded = decoded.replace(
      /&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi,
      (_, n: string | undefined, k: string | undefined) => {
        if (n) {
          const v =
            n[0]?.toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
          return v > 31 && v <= 0x10ffff && !(v >= 0xd800 && v <= 0xdfff)
            ? String.fromCodePoint(v)
            : ' ';
        }
        return (
          (
            {
              amp: '&',
              lt: '<',
              gt: '>',
              quot: '"',
              apos: "'",
              nbsp: ' ',
            } as Record<string, string>
          )[k ?? ''] ?? ' '
        );
      },
    );
  return decoded
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function canonicalUrl(raw: unknown, source: NewsSource) {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    const host = new URL(source.origin).hostname;
    if (
      !['https:', 'http:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hostname !== host ||
      u.port
    )
      return null;
    u.protocol = 'https:';
    u.hash = '';
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|zarsrc|ref$)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return null;
  }
}
export async function digest(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export const normalizedTitle = (t: string) =>
  t
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function duplicateTitle(a: string, b: string) {
  const x = normalizedTitle(a),
    y = normalizedTitle(b);
  if (x === y) return true;
  const aa = new Set(x.split(' ')),
    bb = new Set(y.split(' '));
  if (Math.min(aa.size, bb.size) < 8) return false;
  // Distinct numerical claims must not be merged as the same event.
  if ((x.match(/\d+/g) ?? []).join() !== (y.match(/\d+/g) ?? []).join())
    return false;
  return (
    [...aa].filter((v) => bb.has(v)).length / new Set([...aa, ...bb]).size >=
    0.9
  );
}
export async function parseRss(
  xml: string,
  source: NewsSource,
  asOf: string,
): Promise<RssArticle[]> {
  if (
    xml.length > 2_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error('RSS không hợp lệ');
  const parsed = new XMLParser({
    ignoreAttributes: true,
    processEntities: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'item',
  }).parse(xml);
  const items: unknown = parsed?.rss?.channel?.item;
  if (!Array.isArray(items)) throw Error('Nguồn không phải RSS 2.0');
  const out: RssArticle[] = [];
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw Error('Thời điểm RSS sai');
  for (const raw of items.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = plainText(r.title).slice(0, 300),
      url = canonicalUrl(plainText(r.link), source);
    const time = typeof r.pubDate === 'string' ? Date.parse(r.pubDate) : NaN;
    if (
      !title ||
      !url ||
      !Number.isFinite(time) ||
      time > now + 5 * 60000 ||
      now - time > 7 * 86400000
    )
      continue;
    const fingerprint = await digest(normalizedTitle(title));
    if (out.some((a) => a.source_url === url || duplicateTitle(a.title, title)))
      continue;
    out.push({
      id: await digest(url),
      source_id: source.id,
      source_url: url,
      title,
      excerpt: plainText(r.description).slice(0, 700),
      published_at: new Date(time).toISOString(),
      fetched_at: asOf,
      fingerprint,
    });
  }
  return out;
}
export async function boundedText(response: Response, max = 2_000_000) {
  if (!response.ok || Number(response.headers.get('content-length')) > max)
    throw Error('Nguồn tin không sẵn sàng');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Nguồn rỗng');
  const decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw Error('Nguồn quá lớn');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** RFC-style longest matching path; explicit bot groups override *. Unknown/failed robots are denied by caller. */
export function robotsAllowed(
  text: string,
  path: string,
  agent = 'vnstockanalyzer',
) {
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
  }[] = [];
  let group: (typeof groups)[number] | undefined,
    hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0]!.trim();
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase(),
      v = match[2]!.trim();
    if (key === 'user-agent') {
      if (!group || hasRules) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRules = false;
      }
      group.agents.push(v.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key)) {
      hasRules = true;
      if (v) group.rules.push({ allow: key === 'allow', path: v });
    }
  }
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== '*' && agent.includes(a)),
  );
  const chosen = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen
    .flatMap((g) => g.rules)
    .filter((r) =>
      new RegExp(
        '^' +
          r.path
            .split('*')
            .map((p) => p.replace(/[.+?^{}()|[\]\\]/g, '\\$&'))
            .join('.*')
            .replace(/\\\$$/, '$'),
      ).test(path),
    )
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return rules[0]?.allow ?? true;
}

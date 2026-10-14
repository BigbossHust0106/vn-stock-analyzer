export function safeNext(value: string | null): string {
  return value === '/' ||
    value === '/stocks' ||
    (value !== null && /^\/stocks\?symbol=[A-Za-z0-9]{3,12}$/.test(value)) ||
    value === '/settings' ||
    value === '/watchlists' ||
    value === '/top10'
    ? value
    : '/watchlists';
}

export function safeNext(value: string | null): string {
  return value === '/settings' || value === '/watchlists' || value === '/top10'
    ? value
    : '/watchlists';
}

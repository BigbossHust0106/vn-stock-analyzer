export function safeNext(value: string | null): string {
  return value === '/' ||
    value === '/stocks' ||
    (value !== null && /^\/stocks\?symbol=[A-Za-z0-9]{3,12}$/.test(value)) ||
    value === '/settings' ||
    value === '/watchlists' ||
    value === '/alerts' ||
    value === '/status' ||
    (value !== null &&
      /^\/alerts\?symbol=[A-Za-z0-9]{3,12}&kind=(buy_zone|sell_zone|stop_loss)&lower=\d+(?:\.\d+)?(?:&upper=\d+(?:\.\d+)?)?$/.test(
        value,
      )) ||
    value === '/top10'
    ? value
    : '/watchlists';
}

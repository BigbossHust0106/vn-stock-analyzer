import type { DailyBar } from '../providers/data-provider';
// fetchedAt is an observation time, not a reason to rewrite years of identical bars.
export function changedHistory(
  incoming: readonly DailyBar[],
  previous: readonly DailyBar[],
): DailyBar[] {
  const old = new Map(previous.map((b) => [b.source + ':' + b.sessionDate, b]));
  return incoming.filter((b) => {
    const p = old.get(b.source + ':' + b.sessionDate);
    return (
      !p ||
      b.symbol !== p.symbol ||
      b.openVnd !== p.openVnd ||
      b.highVnd !== p.highVnd ||
      b.lowVnd !== p.lowVnd ||
      b.closeVnd !== p.closeVnd ||
      b.volumeReported !== p.volumeReported ||
      b.isFinal !== p.isFinal ||
      b.priceBasis !== p.priceBasis
    );
  });
}

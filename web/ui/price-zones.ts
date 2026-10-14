import type {
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
} from 'lightweight-charts';
import type { PlanLevel } from '../../modules/trading/trade-plan';
export function priceZones(
  series: ISeriesApi<'Candlestick'>,
  levels: PlanLevel[],
): ISeriesPrimitive {
  const price = (id: string) => levels.find((l) => l.id === id)?.price ?? null;
  const zones = [
    {
      low: price('buy-low'),
      high: price('buy-high'),
      color: '#16b68c26',
      label: 'VÙNG MUA · KỊCH BẢN',
    },
    {
      low: price('stop'),
      high: price('entry'),
      color: '#f05c7518',
      label: 'RỦI RO KẾ HOẠCH',
    },
    {
      low: price('tp1'),
      high: price('tp3') ?? price('tp2'),
      color: '#729bff18',
      label: 'VÙNG CHỐT LỜI · KỊCH BẢN',
    },
  ];
  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        for (const z of zones) {
          if (z.low === null || z.high === null || z.low > z.high) continue;
          const low = series.priceToCoordinate(z.low),
            high = series.priceToCoordinate(z.high);
          if (low === null || high === null) continue;
          context.fillStyle = z.color;
          context.fillRect(
            0,
            Math.min(low, high),
            mediaSize.width,
            Math.max(2, Math.abs(low - high)),
          );
          context.fillStyle = '#718093';
          context.font = '10px Arial';
          context.fillText(z.label, 10, Math.max(12, Math.min(low, high) + 12));
        }
      });
    },
  };
  return {
    paneViews: () => [{ zOrder: () => 'bottom', renderer: () => renderer }],
    autoscaleInfo: () => {
      const values = levels.flatMap((l) => (l.price === null ? [] : [l.price]));
      return values.length
        ? {
            priceRange: {
              minValue: Math.min(...values),
              maxValue: Math.max(...values),
            },
          }
        : null;
    },
  };
}

import { validSourceDate } from '../providers/source-evidence';
export interface TradePlanSettings {
  marginOfSafety: number;
  maxLoss: number;
  atrMultiple: number;
  stopMethod: 'atr' | 'swing' | 'percent';
  entryPriceVnd: number | null;
  entryDate: string | null;
  trailing: boolean;
  trailingPercent: number;
  highWaterVnd: number | null;
  trailingStopVnd: number | null;
  showLevels: boolean;
}
export const defaultTradeSettings: TradePlanSettings = {
  marginOfSafety: 0.25,
  maxLoss: 0.08,
  atrMultiple: 2,
  stopMethod: 'atr',
  entryPriceVnd: null,
  entryDate: null,
  trailing: false,
  trailingPercent: 0.08,
  highWaterVnd: null,
  trailingStopVnd: null,
  showLevels: true,
};
export function validTradeSettings(value: unknown): value is TradePlanSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as TradePlanSettings;
  return (
    [s.marginOfSafety, s.maxLoss, s.atrMultiple, s.trailingPercent].every(
      Number.isFinite,
    ) &&
    s.marginOfSafety >= 0 &&
    s.marginOfSafety <= 0.7 &&
    s.maxLoss >= 0.005 &&
    s.maxLoss <= 0.3 &&
    s.atrMultiple >= 0.5 &&
    s.atrMultiple <= 5 &&
    s.trailingPercent >= 0.005 &&
    s.trailingPercent <= 0.3 &&
    ['atr', 'swing', 'percent'].includes(s.stopMethod) &&
    typeof s.trailing === 'boolean' &&
    typeof s.showLevels === 'boolean' &&
    [s.entryPriceVnd, s.highWaterVnd, s.trailingStopVnd].every(
      (n) => n === null || (Number.isFinite(n) && n > 0 && n <= 1e12),
    ) &&
    (s.entryDate === null ||
      (typeof s.entryDate === 'string' && validSourceDate(s.entryDate)))
  );
}

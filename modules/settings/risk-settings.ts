export interface RiskSettings {
  maxLoss: number;
  atrMultiple: number;
  stopMethod: 'atr' | 'swing' | 'percent';
  trailingPercent: number;
}
export const defaultRiskSettings: RiskSettings = {
  maxLoss: 0.08,
  atrMultiple: 2,
  stopMethod: 'atr',
  trailingPercent: 0.08,
};
export function validRiskSettings(value: unknown): value is RiskSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as RiskSettings;
  return (
    [s.maxLoss, s.atrMultiple, s.trailingPercent].every(Number.isFinite) &&
    s.maxLoss >= 0.005 &&
    s.maxLoss <= 0.3 &&
    s.atrMultiple >= 0.5 &&
    s.atrMultiple <= 5 &&
    s.trailingPercent >= 0.005 &&
    s.trailingPercent <= 0.3 &&
    ['atr', 'swing', 'percent'].includes(s.stopMethod)
  );
}

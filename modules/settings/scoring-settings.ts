export interface ScoringSettings {
  grahamWeight: number;
  buffettWeight: number;
  growthRate: number;
  discountRate: number;
  terminalGrowth: number;
  projectionYears: number;
  maintenanceCapexFraction: number;
}
export const defaultSettings: ScoringSettings = {
  grahamWeight: 50,
  buffettWeight: 50,
  growthRate: 0.05,
  discountRate: 0.12,
  terminalGrowth: 0.02,
  projectionYears: 5,
  maintenanceCapexFraction: 1,
};
export function validateSettings(v: unknown): v is ScoringSettings {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (
    !Object.keys(defaultSettings).every(
      (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
    )
  )
    return false;
  const s = v as ScoringSettings;
  return (
    s.grahamWeight >= 0 &&
    s.grahamWeight <= 100 &&
    s.buffettWeight >= 0 &&
    s.buffettWeight <= 100 &&
    s.grahamWeight + s.buffettWeight === 100 &&
    s.growthRate >= -0.2 &&
    s.growthRate <= 0.2 &&
    s.discountRate >= 0.03 &&
    s.discountRate <= 0.5 &&
    s.terminalGrowth >= -0.05 &&
    s.terminalGrowth <= 0.05 &&
    s.terminalGrowth < s.discountRate &&
    Number.isInteger(s.projectionYears) &&
    s.projectionYears >= 1 &&
    s.projectionYears <= 10 &&
    s.maintenanceCapexFraction >= 0 &&
    s.maintenanceCapexFraction <= 1
  );
}

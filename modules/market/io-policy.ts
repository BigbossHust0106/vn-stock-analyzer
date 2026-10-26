// Keep slow-changing fundamentals and broad rankings separate from live quotes.
export const ioPolicy = Object.freeze({
  maintenanceMinutes: 5,
  rankingMinutes: 30,
  financialMaxAgeMs: 7 * 86400000,
  financialSlotsMs: 5 * 60000,
});
// Observation cadence only. This does not certify an exchange trading session.
export function observationWindow(stamp: number): boolean {
  const local = new Date(stamp + 7 * 3600000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return (
    ![0, 6].includes(local.getUTCDay()) &&
    minute >= 540 &&
    minute <= 900 &&
    !(minute > 690 && minute < 780)
  );
}

import type { SupabaseClient } from '@supabase/supabase-js';
export type Job =
  | 'prices'
  | 'closing'
  | 'market'
  | 'news'
  | 'rankings'
  | 'alerts'
  | 'email'
  | 'vps'
  | 'ingest';
export type JobCode =
  | 'JOB_FAILED'
  | 'SESSION_CLOSED'
  | 'CALENDAR_MISSING'
  | 'PARTIAL_SYNC'
  | 'NEWS_LLM_UNCONFIGURED'
  | 'EMAIL_UNCONFIGURED'
  | 'NO_DATA'
  | 'SOURCE_UNAVAILABLE';
export interface JobOutcome {
  state: 'ok' | 'skipped' | 'degraded';
  code?: JobCode;
}
export async function runJob(
  db: SupabaseClient,
  job: Job,
  stamp: number,
  work: () => Promise<JobOutcome>,
  delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
) {
  const { data: claims, error } = await db.rpc('claim_system_job', {
    task: job,
    stamp: new Date(stamp).toISOString(),
  });
  if (error || !Array.isArray(claims))
    throw Error('Không ghi được nhật ký tác vụ');
  const claim = claims[0] as { id: string; generation: number } | undefined;
  if (!claim) return { state: 'skipped' as const };
  for (let attempt = 1; attempt <= 2; attempt++) {
    let outcome: JobOutcome | { state: 'failed'; code: JobCode };
    try {
      outcome = await work();
    } catch {
      outcome = { state: 'failed', code: 'JOB_FAILED' };
    }
    console.log(
      JSON.stringify({
        component: 'system-job',
        job,
        runId: claim.id,
        attempt,
        state: outcome.state,
        code: outcome.code ?? null,
      }),
    );
    const retry = outcome.state === 'failed' && attempt < 2;
    const { error: writeError } = await db
      .from('system_job_runs')
      .update({
        attempts: attempt,
        state: retry ? 'running' : outcome.state,
        code: outcome.code ?? null,
        finished_at: retry ? null : new Date().toISOString(),
      })
      .eq('id', claim.id)
      .eq('generation', claim.generation);
    if (writeError) throw Error('Không lưu được kết quả tác vụ');
    if (!retry) return outcome;
    await delay(500 * attempt);
  }
  return { state: 'failed' as const, code: 'JOB_FAILED' as const };
}

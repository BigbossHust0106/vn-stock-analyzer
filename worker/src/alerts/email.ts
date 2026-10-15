import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import { boundedText } from '../../../modules/news/rss';
import deployment from '../../../config/public-deployment.json';
export interface AlertEmailConfig {
  ALERT_EMAIL_API_KEY?: string;
  ALERT_EMAIL_FROM?: string;
}
export function emailConfigured(env: AlertEmailConfig) {
  return (
    !!env.ALERT_EMAIL_API_KEY?.trim() &&
    !!env.ALERT_EMAIL_FROM &&
    /^[^\r\n]{3,200}$/.test(env.ALERT_EMAIL_FROM) &&
    /@/.test(env.ALERT_EMAIL_FROM)
  );
}
export async function deliverAlertEmails(
  db: SupabaseClient,
  env: Env,
  timestamp: number,
  fetcher: typeof fetch = fetch,
) {
  if (!emailConfigured(env)) return { configured: false, sent: 0, failed: 0 };
  const { data: queue, error } = await db.rpc('claim_alert_emails');
  if (error || !Array.isArray(queue))
    throw Error('Không lấy được hàng đợi email');
  let sent = 0,
    failed = 0;
  for (const item of queue) {
    let state = 'failed',
      code: string | null = 'EMAIL_DELIVERY_FAILED',
      providerId: string | null = null;
    const { data: n, error: nError } = await db
      .from('notifications')
      .select('*,stocks(symbol)')
      .eq('id', item.notification_id)
      .maybeSingle();
    if (nError) throw Error('Không đọc được thông báo email');
    if (!n) continue;
    const [
      { data: settings, error: sError },
      { data: rule, error: rError },
      { data: auth, error: aError },
    ] = await Promise.all([
      db
        .from('user_settings')
        .select('email_alerts')
        .eq('owner_id', n.owner_id)
        .maybeSingle(),
      n.rule_id
        ? db
            .from('watchlist_alert_rules')
            .select('enabled,email_enabled')
            .eq('id', n.rule_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.auth.admin.getUserById(n.owner_id),
    ]);
    if (sError || rError || aError)
      throw Error('Không kiểm tra được quyền nhận email');
    if (
      !settings?.email_alerts ||
      (n.kind !== 'test' && (!rule?.enabled || !rule?.email_enabled))
    ) {
      state = 'cancelled';
      code = 'EMAIL_OPTED_OUT';
    } else if (!auth.user?.email || !auth.user.email_confirmed_at) {
      state = 'cancelled';
      code = 'EMAIL_NOT_CONFIRMED';
    } else if (timestamp - Date.parse(n.created_at) > 23 * 3600000) {
      state = 'failed';
      code = 'EMAIL_EXPIRED';
    } else
      try {
        const response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(12000),
          headers: {
            Authorization: 'Bearer ' + env.ALERT_EMAIL_API_KEY,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'watchlist-alert/' + n.id,
          },
          body: JSON.stringify({
            from: env.ALERT_EMAIL_FROM,
            to: [auth.user.email],
            subject: '[VN Stock] ' + n.title,
            text:
              n.title +
              '\n\n' +
              n.body +
              '\n\n' +
              (n.source_url ? 'Nguồn: ' + n.source_url + '\n' : '') +
              'Xem thông báo: ' +
              deployment.workerUrl +
              '/alerts\nTắt email tại trang Cảnh báo.\nChỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
          }),
        });
        if (response.ok) {
          const result = JSON.parse(await boundedText(response, 20000)) as {
            id?: unknown;
          };
          if (typeof result.id !== 'string')
            throw Error('Invalid email receipt');
          state = 'sent';
          code = null;
          providerId = result.id;
          sent++;
        } else {
          await response.body?.cancel();
          if (
            (response.status === 429 || response.status >= 500) &&
            item.attempts < 3
          ) {
            state = 'pending';
            code = 'EMAIL_RETRY';
          } else code = 'EMAIL_PROVIDER_REJECTED';
        }
      } catch {
        state = item.attempts < 3 ? 'pending' : 'failed';
        code = 'EMAIL_TRANSPORT_FAILED';
      }
    if (state === 'failed') failed++;
    const { error: writeError } = await db
      .from('alert_email_outbox')
      .update({
        state,
        code,
        provider_id: providerId,
        lease_until: null,
        next_attempt_at: new Date(
          timestamp + Math.pow(2, item.attempts) * 5 * 60000,
        ).toISOString(),
        updated_at: new Date(timestamp).toISOString(),
      })
      .eq('notification_id', item.notification_id)
      .eq('attempts', item.attempts)
      .eq('state', 'sending');
    if (writeError) throw Error('Không lưu được biên nhận email');
  }
  return { configured: true, sent, failed };
}

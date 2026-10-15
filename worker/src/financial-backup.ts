import type { SupabaseClient } from '@supabase/supabase-js';
import {
  VietcapReportsProvider,
  type FinancialBackup,
} from '../../modules/providers/financial-backup';
const provider = new VietcapReportsProvider();
export async function syncFinancialBackup(
  db: SupabaseClient,
  stockId: string,
  symbol: string,
) {
  const { data: stored, error: readError } = await db
    .from('financial_report_backups')
    .select('fetched_at')
    .eq('stock_id', stockId)
    .eq('source', 'VIETCAP_REPORTS')
    .maybeSingle();
  if (readError) throw Error('Không đọc được trạng thái BCTC dự phòng');
  if (stored && Date.now() - Date.parse(stored.fetched_at) < 86400000) return;
  try {
    const payload: FinancialBackup =
      await provider.fetchFinancialReports(symbol);
    const { error } = await db.from('financial_report_backups').upsert(
      {
        stock_id: stockId,
        source: payload.source,
        payload,
        fetched_at: payload.fetchedAt,
        last_error: null,
      },
      { onConflict: 'stock_id,source' },
    );
    if (error) throw Error('Không lưu được BCTC dự phòng');
  } catch {
    await db
      .from('financial_report_backups')
      .update({
        last_error: 'Nguồn dự phòng chưa khả dụng; giữ nguyên bản đã lưu.',
      })
      .eq('stock_id', stockId)
      .eq('source', 'VIETCAP_REPORTS');
    throw Error(
      'Nguồn BCTC dự phòng chưa khả dụng; không thay dữ liệu chuẩn hóa.',
    );
  }
}

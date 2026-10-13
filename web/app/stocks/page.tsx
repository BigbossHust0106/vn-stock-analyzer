import { Suspense } from 'react';
import { StockDetail } from '../../ui/stock-detail';
export default function Page() {
  return (
    <Suspense fallback={<p>Đang mở trang mã…</p>}>
      <StockDetail />
    </Suspense>
  );
}

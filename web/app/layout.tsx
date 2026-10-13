import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { ThemeSwitch } from '../ui/theme-switch';

export const metadata: Metadata = {
  title: 'Đánh giá cổ phiếu Việt Nam',
  description: 'Hạ tầng phân tích cổ phiếu HOSE, HNX và UPCOM',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" data-theme="dark" suppressHydrationWarning>
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            <span className="brand-icon">↗</span>VN<span>Stock</span>
            <small>VIỆT NAM</small>
          </Link>
          <nav>
            <Link href="/">Tra cứu mã</Link>
            <ThemeSwitch />
          </nav>
        </header>
        <main className="page-content">{children}</main>
        <footer className="site-footer">
          <span>VN Stock · HOSE / HNX / UPCOM</span>
          <p>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</p>
        </footer>
      </body>
    </html>
  );
}

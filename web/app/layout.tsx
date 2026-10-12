import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}

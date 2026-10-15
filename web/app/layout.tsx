import { AuthProvider } from '../ui/auth-provider';
import { AppShell } from '../ui/app-shell';
import { PwaProvider } from '../ui/pwa-provider';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VN Stock · Cổ phiếu Việt Nam',
  applicationName: 'VN Stock',
  other: { 'apple-mobile-web-app-capable': 'yes' },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'VN Stock', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [
      { url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  description: 'Hạ tầng phân tích cổ phiếu HOSE, HNX và UPCOM',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#376f5c',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <body>
        <PwaProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </PwaProvider>
      </body>
    </html>
  );
}

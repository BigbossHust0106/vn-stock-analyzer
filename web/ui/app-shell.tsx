'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthNav } from './auth-nav';
import { RequireAuth } from './require-auth';
import { ThemeSwitch } from './theme-switch';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') return children;
  if (pathname.startsWith('/auth/'))
    return <main className="auth-utility">{children}</main>;
  return (
    <RequireAuth>
      <header className="site-header">
        <Link className="brand" href="/">
          <span className="brand-icon">↗</span>VN<span>Stock</span>
          <small>VIỆT NAM</small>
        </Link>
        <nav aria-label="Chức năng chính">
          <Link href="/">Tra cứu mã</Link>
          <Link href="/top10">Top 10</Link>
          <Link href="/watchlists">Theo dõi</Link>
          <Link href="/settings">Cài đặt</Link>
          <AuthNav />
          <ThemeSwitch />
        </nav>
      </header>
      <main className="page-content">{children}</main>
      <footer className="site-footer">
        <span>VN Stock · HOSE / HNX / UPCOM</span>
        <p>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</p>
      </footer>
    </RequireAuth>
  );
}

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
          <Link
            href="/"
            aria-current={
              pathname === '/' || pathname === '/stocks' ? 'page' : undefined
            }
          >
            Tra cứu mã
          </Link>
          <Link
            href="/top10"
            aria-current={pathname === '/top10' ? 'page' : undefined}
          >
            Top 10
          </Link>
          <Link
            href="/watchlists"
            aria-current={pathname === '/watchlists' ? 'page' : undefined}
          >
            Theo dõi
          </Link>
          <Link
            href="/settings"
            aria-current={pathname === '/settings' ? 'page' : undefined}
          >
            Cài đặt
          </Link>
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

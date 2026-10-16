'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MobileNav } from './mobile-nav';
import { HeaderSearch } from './header-search';
import { AuthNav } from './auth-nav';
import { RequireAuth } from './require-auth';
import { NotificationBell } from './notification-bell';
import { ThemeSwitch } from './theme-switch';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') return children;
  if (pathname === '/install' || pathname.startsWith('/auth/'))
    return <main className="auth-utility">{children}</main>;
  return (
    <RequireAuth>
      <header className="site-header">
        <Link className="brand" href="/">
          <span className="brand-icon">↗</span>VN<span>Stock</span>
          <small>VIỆT NAM</small>
        </Link>
        <nav aria-label="Chức năng chính">
          <HeaderSearch />
          <Link
            href="/paper"
            aria-current={pathname === '/paper' ? 'page' : undefined}
          >
            Đầu tư thử
          </Link>
          <Link
            href="/backtest"
            aria-current={pathname === '/backtest' ? 'page' : undefined}
          >
            Backtest
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
          <NotificationBell />
          <Link
            href="/status"
            aria-current={pathname === '/status' ? 'page' : undefined}
          >
            Trạng thái
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
      <MobileNav />
    </RequireAuth>
  );
}

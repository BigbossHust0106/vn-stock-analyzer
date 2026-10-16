'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const paths = {
  paper: 'M3 7h18v14H3V7Zm3 0V3h12v4M3 12h18m-11-2h4v4h-4Z',
  top10: 'm4 7 4 3 4-6 4 6 4-3-2 12H6L4 7Z',
  watchlists: 'M6 4h12v17l-6-4-6 4V4Z',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
};
function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
export function MobileNav() {
  const route = usePathname();
  return (
    <nav className="mobile-nav" aria-label="Điều hướng điện thoại">
      <button
        type="button"
        onClick={() => {
          const input = document.querySelector<HTMLInputElement>(
            '#header-stock-query',
          );
          input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          input?.focus();
        }}
      >
        <Icon path="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6" />
        <span>Tìm mã</span>
      </button>
      {(
        [
          ['top10', 'Top 10'],
          ['watchlists', 'Theo dõi'],
          ['paper', 'Đầu tư thử'],
          ['settings', 'Cài đặt'],
        ] as const
      ).map(([key, label]) => (
        <Link
          key={key}
          href={'/' + key}
          aria-current={route === '/' + key ? 'page' : undefined}
        >
          <Icon path={paths[key]} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

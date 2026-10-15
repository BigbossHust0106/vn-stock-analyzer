'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePwaInstall } from './pwa-provider';
export function InstallApp() {
  const { available, standalone, install, status } = usePwaInstall();
  return (
    <section className="install-app" data-testid="install-app">
      <Image
        src="/icons/icon-192.png"
        alt="VN Stock"
        width={88}
        height={88}
        priority
      />
      <span className="eyebrow">ỨNG DỤNG TRÊN ĐIỆN THOẠI</span>
      <h1>Mang VN Stock lên màn hình chính.</h1>
      <p>
        Tra cứu, Top 10, danh sách theo dõi và đánh giá Graham/Buffett trong
        giao diện toàn màn hình. Dùng chung tài khoản và dữ liệu với website.
      </p>
      {standalone ? (
        <p className="install-success" role="status">
          Bạn đang mở VN Stock ở chế độ ứng dụng.
        </p>
      ) : available ? (
        <button className="install-primary" onClick={() => void install()}>
          Cài VN Stock
        </button>
      ) : (
        <p className="install-hint">
          Cài bằng menu trình duyệt theo hướng dẫn bên dưới. Tên mục có thể khác
          giữa các phiên bản.
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <div className="install-guides">
        <article>
          <h2>Android · Chrome</h2>
          <ol>
            <li>Mở website này bằng Chrome.</li>
            <li>
              Bấm <b>Cài VN Stock</b> nếu xuất hiện, hoặc mở menu <b>⋮</b>.
            </li>
            <li>
              Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b>,
              rồi xác nhận.
            </li>
          </ol>
        </article>
        <article>
          <h2>iPhone / iPad · Safari</h2>
          <ol>
            <li>
              Mở website này bằng <b>Safari</b>.
            </li>
            <li>
              Bấm <b>Chia sẻ</b> (ô vuông có mũi tên hướng lên).
            </li>
            <li>
              Chọn <b>Thêm vào Màn hình chính</b>; bật{' '}
              <b>Mở dưới dạng ứng dụng</b> nếu có, rồi bấm <b>Thêm</b>.
            </li>
          </ol>
        </article>
      </div>
      <p className="install-hint">
        Mở từ biểu tượng VN Stock sau khi cài. Cần mạng để đăng nhập và cập nhật
        giá/BCTC; khi mất mạng, app không tự tạo số liệu. Cập nhật ứng dụng được
        cung cấp qua website.
      </p>
      <Link className="install-open" href="/">
        Mở VN Stock →
      </Link>
      <p className="data-timestamp">
        Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.
      </p>
    </section>
  );
}

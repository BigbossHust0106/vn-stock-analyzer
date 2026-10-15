# VN Stock trên Android và iPhone

## Cài ứng dụng

Mở https://vn-stock-analyzer.manhhuong.workers.dev/install trên điện thoại.

- **Android:** dùng Chrome → bấm **Cài VN Stock** nếu có; hoặc menu **⋮ → Cài đặt ứng dụng / Thêm vào màn hình chính** → xác nhận.
- **iPhone/iPad:** dùng Safari → **Chia sẻ → Thêm vào Màn hình chính** → bật **Mở dưới dạng ứng dụng** nếu xuất hiện → **Thêm**.
- Nếu mở từ trình duyệt trong Zalo/Facebook, mở lại URL bằng Chrome hoặc Safari.
- Sau đó mở biểu tượng VN Stock trên màn hình chính. Tùy trình duyệt có thể cần đăng nhập lại; vẫn dùng cùng tài khoản Supabase và dữ liệu như website.
- Có liên kết cài đặt trên trang đăng nhập và trong menu ảnh đại diện. Không cần qua kho ứng dụng.

## Đã triển khai

Manifest có id/scope ổn định, start URL `/?source=pwa`, `display=standalone`, icon PNG192/512 và maskable, Apple touch icon180, theme mint/lavender. Thẻ Apple legacy được thêm riêng vì Next.js16.4 xuất thẻ chuẩn `mobile-web-app-capable`; không tự giả định nó đã xuất thẻ Apple.

Điện thoại có thanh điều hướng dưới, nút tìm mã ngay trên header và khoảng chừa safe-area cho thiết bị có tai thỏ/thanh Home. Giữ chức năng đăng nhập, tra cứu, Top10, watchlist và cài đặt hiện có. Modal watchlist có thứ tự lớp cao hơn thanh điều hướng. Đã ghép main mới có cảnh báo/trạng thái: chuông cảnh báo vẫn hiện trên header điện thoại và trang trạng thái có trong menu tài khoản.

Trình duyệt Chromium hỗ trợ `beforeinstallprompt` sẽ cho bấm cài khi nó phát sự kiện đủ điều kiện. Safari dùng menu Chia sẻ; không giả lập cửa sổ cài của iOS. Chấp nhận prompt chưa được coi là đã cài xong trên hệ điều hành.

## Offline và quyền riêng tư

Service worker `/sw.js` chỉ lưu **ba tài nguyên công khai** vào CacheStorage riêng `vn-stock-pwa-v1`:

- `/offline.html`
- `/icons/icon-192.png`
- `/icons/icon-512.png`

**Không cache API `/v1/*`, OAuth `/auth/*`, request Supabase khác origin, mutation hoặc HTML trang tài khoản.** Điều hướng dùng mạng trước; mất mạng chỉ trả trang offline công khai, không trả số liệu mẫu hoặc danh sách cá nhân cũ. Chỉ đọc cache đúng tên ứng dụng, xóa cache phiên bản cũ có cùng prefix, không xóa cache ứng dụng khác.

Khi mất mạng trong một trang đang mở, banner ghi rõ dữ liệu trên màn hình đã tải trước đó và không cập nhật trực tiếp. Auth/session localStorage vẫn do Supabase SDK và cơ chế owner/RLS của website quản lý; PWA không tạo bản sao offline của dữ liệu cá nhân. Cache HTTP và bộ nhớ trình duyệt thông thường có quy tắc riêng của website; mô tả trên là chính sách CacheStorage của service worker.

Cần HTTPS, ngoại trừ localhost khi phát triển. `_headers` cấu hình script SW không cache HTTP và đúng MIME manifest trên Cloudflare. Có thông báo cho người dùng chủ động áp dụng SW mới; không tự reload khi họ đang ghi chú/cài đặt. Khi đổi tài nguyên offline, tăng tên CACHE trong SW để làm mới phiên bản rõ ràng.

## Kiểm tra đã chạy

- `npm run verify`: 9/9 PASS; 163 unit PASS, 41 provider PASS, 1 TODO cũ; 16 migration và RLS PASS. `npm run smoke`: web/Worker/API input PASS. Log nguyên văn [verify-pwa-2026-10-15.txt](verify-pwa-2026-10-15.txt).
- Unit bảo vệ cache: API/Auth/external/mutation không bị SW chặn hoặc ghi; điều hướng chỉ dùng mạng hoặc trang công khai; chỉ xóa cache có prefix của mình; kích thước PNG và manifest hợp lệ.
- `npm run verify:pwa:browser`: Chromium với viewport390px; manifest/MIME/PNG/metadata iOS, SW thực sự điều khiển trang, CacheStorage chỉ có ba tài nguyên công khai cả trước và sau đăng nhập thật; tắt mạng không đọc được API và nhận trang offline. Bật lại mạng hoạt động tiếp; bottom navigation/tìm mã/menu cài đặt hoạt động.
- Test prompt dùng sự kiện **mô phỏng** để kiểm tra nút và trạng thái hủy; **không phải cài đặt thực tế trên Android/iPhone**.
- Browser hồi quy login gate năm route, login/logout/reload thật; tìm mã trên header, tin mở rộng, responsive390/768px. [Output browser nguyên văn](browser-pwa-2026-10-15.txt).
- Tài khoản thử được tạo qua Supabase Auth quản trị và xóa sau test; không dùng tài khoản người dùng khác.

## Lỗi tự tìm thấy và đã sửa

- Next.js mới không tự xuất thẻ Apple legacy dù đã cấu hình appleWebApp: bổ sung metadata riêng và kiểm tra DOM trình duyệt.
- Đọc cache không chỉ định tên có thể trùng tài nguyên ứng dụng khác: giới hạn cacheName và chỉ xóa prefix của mình.
- Thanh điều hướng có thể chồng lên modal watchlist: tăng lớp modal; chừa safe-area và footer cho menu cố định.
- Hàm mock native prompt bên trong page.evaluate bị helper __name của TSX khi serialize: dùng Promise.resolve.bind cho mock, không sửa app hay nới assertion.

## Chưa xác minh / rủi ro còn lại

- Chưa cài biểu tượng lên thiết bị Android/iPhone vật lý, chưa chạy consent Google OAuth trong app đã cài trên thiết bị thật. Browser test xác nhận web/PWA contracts và email Auth, không thay cho kiểm tra hệ điều hành.
- Thời điểm và giao diện hiện nút cài phụ thuộc Chrome/Safari, hệ điều hành và việc app đã được cài trước đó. Luôn có hướng dẫn menu thay thế.
- Cần mạng để có giá/BCTC và thay đổi dữ liệu tài khoản; không có giao dịch hay cập nhật giá offline.
- Không thay công thức tài chính, ranking policy, RLS hay provider trong nhiệm vụ PWA. TODO lastVolume cũ vẫn được ghi rõ.

## Tự kiểm tra

1. Chạy `npm ci && npm run verify`.
2. Build web, chạy `npm run dev:market`; trong môi trường Playwright/CA phù hợp chạy `npm run verify:pwa:browser` với cùng URL ứng dụng. User thử cần quyền quản trị Supabase từ biến môi trường, không đưa secret vào source.
3. Trên thiết bị thật mở `/install`, làm theo hướng dẫn theo hệ điều hành; mở icon và xác nhận chế độ ứng dụng, đăng nhập, watchlist, tìm mã.
4. Mở app khi có mạng rồi bật chế độ máy bay: màn hình đang mở có banner; tải lại vào trang offline. Bật mạng và thử kết nối lại.
5. DevTools → Application → Manifest/Service Workers/Cache Storage: chỉ có ba file công khai, không có token/API/watchlist trong cache SW. Bản cập nhật có thể cần đóng/mở lại app hoặc bấm cập nhật khi được báo.

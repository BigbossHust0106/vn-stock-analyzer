# Giao diện pastel và tải dữ liệu theo nhu cầu — 15/10/2026

## Thay đổi

- Đồng bộ đăng nhập, trang chủ, tra cứu, chi tiết mã, Top 10, watchlist, cài đặt và các biểu mẫu tài khoản theo tông mint/lavender gradient; vẫn có dark mode.
- Thay hình vẽ cũ bằng ảnh thật bull/bear tại Sở giao dịch Frankfurt. [Nguồn, tác giả và giấy phép](image-attribution.md) được hiển thị cả trên trang đăng nhập.
- Header dùng ảnh đại diện Google hoặc chữ viết tắt; menu có cài đặt, watchlist, đổi mật khẩu, đăng xuất. Đóng bằng Escape hoặc bấm bên ngoài.
- Top 10 dùng dropdown ngày/tháng/quý, chỉ tải bảng đang chọn. Giữ nguyên yêu cầu bằng chứng đầy đủ; không tạo cổ phiếu giả để đủ 10 dòng.
- Mặc định tắt tải biểu đồ nến. Bật thì mới tải module biểu đồ/kế hoạch giao dịch và lịch sử; tắt sẽ hủy yêu cầu đang chạy. Lựa chọn được nhớ trên thiết bị.

## Giá và hiệu năng

`GET /v1/stocks/{symbol}?view=summary` đọc quote và giá đóng cửa lưu trong Supabase song song, trả ngay dữ liệu đã lưu; không đợi hồ sơ công ty hoặc tải ba năm lịch sử. `view=history` tách riêng; API cũ không có `view` vẫn tương thích.

Trước 09:00 giờ Việt Nam, ưu tiên giá đóng cửa phiên gần nhất có dữ liệu trước hôm nay, kể cả quote còn giữ giá khớp phiên cũ. Quote rỗng hoặc tải từ ngày cũ cũng dùng giá đóng cửa. Hiển thị rõ ngày/nguồn và không gọi giá đóng cửa là giá khớp hiện tại. Không dùng tham chiếu giả làm giá đóng cửa. Nếu cả hai nguồn chưa có hoặc lỗi thì thông báo đang đồng bộ, không bịa một số.

Giá dự phòng chỉ phục vụ hiển thị; không thay quote đầu vào chấm điểm, không tự xác minh timestamp sàn, điều chỉnh giá hoặc phiên đã chốt. Mốc 09:00 không thay lịch giao dịch/ngày nghỉ của cron.

Cache:

- Client summary 15 giây, thăm dò mỗi 30 giây khi tab hiện; chuyển trang quay lại giữ snapshot sẵn có.
- Lịch sử client 60 giây, chỉ thăm dò khi bật biểu đồ và tab hiện.
- Quote làm mới nền tối đa mỗi 30 giây/mã/isolate; timeout 5 giây, không retry kéo dài đường tải trang.
- Lịch sử và close làm mới nền tối đa mỗi 15 phút/mã/isolate; timeout 8 giây. Cache close riêng không trộn cơ sở điều chỉnh với chuỗi lịch sử đầy đủ.
- Nút Cập nhật chủ động chờ quote mới trong giới hạn timeout, lỗi vẫn giữ snapshot tốt.
- Không có cache thì lần tải đầu vẫn có thể chờ upstream. Giới hạn isolate không phải giới hạn toàn cục của nhà cung cấp.

Migration `202610150001_closing_snapshots.sql`: bảng cache giá đóng cửa có RLS đọc công khai; RPC ghi chỉ service role, từ chối ngày hiện tại/tương lai và không cho snapshot cũ đè bản mới. Đã chạy trên Supabase dự án đang kết nối.

## Đã xác minh bằng máy

- `npm run verify`: xem toàn bộ output nguyên văn tại [verify-ui-refresh-2026-10-15.txt](verify-ui-refresh-2026-10-15.txt).
- `npm run verify:migrations`: 11 migration PASS; `npm run verify:rls`: PASS trên PostgreSQL local.
- `npm run verify`: 9/9 PASS, 141 unit PASS, 36 provider PASS, 1 TODO đã công khai; `npm run smoke`: web/Worker/API input PASS.
- Browser live sau khi ghép main mới nhất: VNM/FPT/HPG có giá và canvas, tính độc lập MA20/50/200 và volume; tìm bằng mã/tên/Enter; dark mode ghi nhớ, 390px không tràn. Browser scoring vẫn kiểm tra EPS/Graham/scenario DCF/MOS và bảo vệ DCF công ty mẹ chưa xác minh. Login gate/Auth thật, 360/390/768px PASS. [Output nguyên văn](browser-ui-refresh-2026-10-15.txt).
- Browser `scripts/browser-refresh-ui.ts`: Auth thật bằng user thử tạm thời (xóa sau chạy), dữ liệu thị trường từ fixture để kiểm tra UI có thể tái lập. Kiểm tra ảnh tải thành công; giá đóng cửa; không yêu cầu history khi tắt; bật mới có canvas; nhớ trạng thái; menu/Escape/đăng xuất; mỗi lần chỉ một horizon; đổi dark mode; năm trang ở rộng 390px không tràn ngang và không có lỗi JavaScript. Đây không phải xác minh giá live.
- Đo handler API với Supabase thật: VNM/FPT/HPG, hai lần/mã, HTTP 200, 796–1093ms, trả giá đóng cửa phiên 14/10/2026 lần lượt 57.700/57.300/20.700 VND và không chuyển history trong summary. Đây là mẫu thời gian API, không phải cam kết tốc độ tải toàn trang hoặc benchmark trước/sau.
- Unit hồi quy kiểm tra close 20,45 nghìn → 20.450 VND, preopen có quote cũ, quote timestamp lỗi, bỏ close ngày hiện tại, giữ raw quote, summary trả được khi refresh nền bị treo, chọn bản sửa close mới hơn cùng ngày; history lưu sẵn không gọi quote/profile.

## Lỗi tự tìm thấy và đã sửa

- JPG thật đi vào `/_next/image` không tồn tại trên static export: cấu hình images.unoptimized, thêm MIME JPEG ở server kiểm thử.
- Quote dương còn sót trước giờ mở cửa: ưu tiên close có ngày thay vì coi đó là giao dịch hôm nay.
- Cache close cũ cùng ngày có thể che bản lịch sử đã sửa: chọn quan sát mới hơn.
- Phải mở menu mới đăng xuất/bật chart mới có history: cập nhật browser scripts hiện có theo hành vi mới, giữ các assertion số độc lập.

## Chưa xác minh và rủi ro còn lại

- Không chứng nhận thời điểm giao dịch từ fetchedAt. Giá nguồn và cơ sở điều chỉnh vẫn có giới hạn đã ghi ở docs/data-sources.md.
- TODO lastVolume chưa đủ số đối chiếu vẫn giữ nguyên. Không sửa công thức tài chính hoặc ngưỡng chất lượng xếp hạng trong nhiệm vụ giao diện.
- Không thể bảo đảm luôn có số nếu toàn bộ nguồn và snapshot chưa tồn tại; UI không tự tạo giá.
- Ảnh bên ngoài đã lưu tại repo để không phụ thuộc hotlink; tuân thủ credit/giấy phép trong tài liệu nguồn.

## Cách tự kiểm tra

1. `npm ci && npm run verify`.
2. Mở trang đăng nhập: ảnh bull/bear thật và gradient mint/lavender; đổi dark mode.
3. Đăng nhập; bấm avatar, thử cài đặt/đổi mật khẩu/watchlist/đăng xuất.
4. Mở VNM/FPT/HPG: xem giá, nhãn ngày của giá đóng cửa khi trước giờ mở; Network không có `view=history` nếu chưa bật nến.
5. Bật/tắt “Tự động tải biểu đồ nến”, tải lại trang để kiểm tra ghi nhớ; bật mới tải history/canvas.
6. Top 10 chọn ngày/tháng/quý; mỗi lần chỉ một bảng. Thu màn hình về 390px.
7. Browser tự động: build web với NEXT_PUBLIC_WORKER_URL trỏ server local, chạy `npm run dev:market` và `npm run verify:ui:browser` trong môi trường Playwright có CA proxy tin cậy, cùng kết nối Supabase quản trị cho user thử. Không cần secret trong source.

# Bàn giao Phần 4 — 14/10/2026

Mã cho Auth, ba bảng Top10 và watchlist đã triển khai; migration/nguồn thật đã áp dụng trên project `aszceahzutkhqfpyclev`. Vẫn còn điều kiện bên ngoài để bật Google và tính kỹ thuật/Cron đầy đủ. Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.

## 1. ĐÃ XÁC MINH BẰNG MÁY

`npm run verify`:

```text
VERIFY PASS
```

9/9 bước: typecheck, lint, format, coverage/tests, build, secrets, migrations PostgreSQL, RLS, provider parsers. Kết quả chi tiết được lưu cùng repo trong `docs/verify-phase4-2026-10-14.txt`.

`npm run verify:phase4:live -- --browser`, với build local trỏ đúng API Worker tại 8878, không mock nguồn:

```text
AUTH LIVE PASS: 2 user tạm đăng nhập email/password qua Supabase Auth, nhận JWT thật
RLS HOSTED PASS: JWT A/B isolation; own notes/target CRUD; forged owner/parent and anon denied
TOP10 HOSTED PASS: day, 10 rows từ rankings/scores thật
TOP10 HOSTED PASS: month, 10 rows từ rankings/scores thật
TOP10 HOSTED PASS: quarter, 10 rows từ rankings/scores thật
BROWSER PHASE4 PASS: route guard, email login/logout, multiple lists, note/target persistence, add/remove, Top10 real, 390px, no JS errors
CLEANUP PASS: users tạm và dữ liệu riêng cascade đã xóa
```

`npm run smoke`:

```text
SMOKE PASS: web, HTTP 200, nội dung hello world đúng
SMOKE PASS: worker, HTTP 200, nội dung hello world đúng
SMOKE PASS: API input 400, thiếu Supabase 503
```

Hai migration mới được chạy thật: `20261014012828_phase4_rankings_watchlists`, `20261014015654_ranking_reference_prices`. Project có 16/14/16 vị trí hợp lệ ngày/tháng/quý ở lượt kiểm tra; API lấy 10 sau bộ lọc. BCTC, tham chiếu/phân ngành KBS, sự kiện Vietcap đều được gọi nguồn thật; không seed fixture. Các số đếm là snapshot, có thể đổi sau cron.

## 2. CHƯA XÁC MINH / GIẢ ĐỊNH

- Google OAuth chưa có Client ID/Secret và provider còn tắt. Có code PKCE/callback, chưa tuyên bố OAuth end-to-end thành công.
- Chưa test gửi/nhận email xác nhận/reset qua SMTP. Test password dùng user tạm đã xác nhận bằng admin, không thay thế email delivery.
- Lịch phiên production rỗng; adjusted/unadjusted lịch sử chưa được chứng nhận. Guard intraday/EOD có kiểm thử nhưng chưa vận hành trên lịch thật; kỹ thuật/volume thiếu hiển thị null, không chấm prices_history unverified.
- Lịch KQKD chưa có nguồn được xác nhận; không suy ngày sự kiện từ ngày công bố tin hoặc kỳ quý. Có bảng/import cho nguồn lịch KQKD được xác minh sau này.
- BCTC nguồn provider_reported, DCF là proxy/giả định như Phần 3; confidence không phải xác suất tăng giá.

## 3. LỖI TỰ TÌM THẤY VÀ ĐÃ SỬA

- VPS trước mở cửa có `openPrice/side=null` khi `lastPrice=0`. Parser giữ giá giao dịch null, không thay bằng tham chiếu rồi gọi là khớp lệnh.
- History OHLC lỗi không được đưa vào scoring; trạng thái degraded, giữ dữ liệu cũ. Một mã BCTC lỗi không hủy mọi mã đã đồng bộ hợp lệ.
- Xếp hạng có transaction/khóa: không xuất bản một phần ba horizon, không để lượt cũ ghi đè. Filter chạy trước Top10.
- Note/target có constraint, owner RLS và FK parent ghép. Hosted test parent dùng mã khác để lỗi duplicate không che phép kiểm tra ownership.
- Select/textarea có tên truy cập ổn định sau điền/reload; sửa form thiếu style phát hiện từ ảnh browser.
- Logout có một luồng redirect; state danh sách trong modal reset khi account đổi, watchlist page key theo Auth UID.
- Google chưa bật không chuyển người dùng đến trang JSON lỗi Supabase; UI hướng dẫn dùng email/password.

## 4. RỦI RO CÒN LẠI

- VPS có 503/biến thể schema; chưa xác minh mọi trường/thời gian sàn. Tham chiếu KBS có nhãn riêng, không thay thế chứng nhận giá giao dịch hiện tại.
- Universe cấu hình 35 mã có khả năng BCTC; chưa phải quét toàn bộ 1.522 mã. Có mã bị loại vì dữ liệu cơ bản thiếu/không đủ chất lượng; không lấp đầy bằng dữ liệu giả.
- Điểm ngày/tháng hiện thiếu nhóm kỹ thuật và có thể thiếu sự kiện; tổng điểm là đóng góp bảo thủ trên trọng số cố định, mức bao phủ được hiển thị.
- Supabase advisor không báo lỗi RLS, có [Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); chưa bật tính năng theo gói/cấu hình project.
- Token Cloudflare của environment thấy account Stockanalysis, không xác nhận quyền Worker cũ trên manhhuong.workers.dev. Người dùng chọn phát hành bằng kết nối GitHub hiện có; push main và kiểm tra deployment riêng, không tạo Worker ở account khác.

## 5. CÁCH TÔI TỰ KIỂM TRA

1. `/watchlists` khi chưa đăng nhập phải về `/login?next=/watchlists`.
2. Đăng nhập email, tạo hai danh sách, thêm VNM, ghi chú/giá 48.000 VND; reload và xác nhận dữ liệu giữ nguyên. Xóa mã phải xóa đúng danh sách.
3. `/top10` phải có ba bảng dữ liệu nguồn thật, lọc sàn/ngành/vốn hóa, thêm mã vào danh sách chọn; giá tham chiếu có nhãn, điểm thiếu ghi rõ.
4. Kiểm tra mobile 390px, không overflow trang, không lỗi JavaScript; logout rồi thử vào watchlist phải bị bảo vệ.
5. Rerun verifier hosted hai user: A không đọc/sửa/xóa B, không giả owner/gắn mã vào parent B; anon bị từ chối. User tạm được cleanup.

Chi tiết cấu hình, nguồn, trọng số và lệnh vận hành: [phase4.md](phase4.md).

## Trạng thái phát hành sau push

Commit Phần4 `2804dc9` đã push main, GitHub Actions verify thành công; Actions deploy SKIPPED vì đang dùng Workers Builds. Build `0612d357-d030-401e-ad7a-9b64804b5460` của Cloudflare thất bại trước khi chạy mã:

> The build token selected for this build has been deleted or rolled and cannot be used for this build.

Kết nối Cloudflare quản lý Worker có quyền đọc build/logs đúng account9a0d6d0 nhưng không có quyền quản lý API token (`9109: Unauthorized`). Cần chủ tài khoản cập nhật `vnstock build token` ở Workers Builds settings rồi retry main. Tại thời điểm kiểm tra `/top10`, `/login` và `/v1/rankings` production vẫn404; không tuyên bố đã phát hành thành công.

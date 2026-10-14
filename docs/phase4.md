# Phần 4: đăng nhập, Top 10 và watchlist

Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.

## Hành vi

- `/login`: giao diện hai cột nền sáng, minh họa bò/biểu đồ chứng khoán; mobile một cột. Email/password, đăng ký xác nhận email, quên mật khẩu, hiện/ẩn mật khẩu, Google OAuth PKCE. Không có menu hoặc nội dung tính năng. Tài khoản đã đăng nhập được chuyển về trang đích.
- `/auth/callback`: đổi code một lần, xóa code khỏi URL; `next` chỉ được phép là `/`, `/stocks` (có thể kèm `?symbol=VNM` với mã hợp lệ), `/watchlists`, `/settings`, `/top10`.
- Toàn bộ trang tính năng `/`, `/stocks`, `/top10`, `/watchlists`, `/settings` chỉ dựng giao diện và tải dữ liệu sau `getUser()`. Truy cập trực tiếp khi chưa đăng nhập chuyển về `/login?next=...`; giữ mã cổ phiếu khi quay lại. `/auth/password` cũng yêu cầu đăng nhập; callback/khôi phục không có menu tính năng. Ứng dụng là Next static export: cổng giao diện nằm ở client, không phải phân quyền HTML tại server. Dữ liệu thị trường/API đọc công khai tiếp tục dùng public RLS. Dữ liệu riêng được bảo vệ bằng RLS và `getUser` tại `/v1/watchlists`. Private API không cache và dùng public key + JWT người dùng, không dùng service_role.
- `/top10`: ba bảng cùng trang; sàn, phân ngành KBS, vốn hóa; lọc **trước** lấy 10 dòng. Hiển thị điểm thành phần, mức bao phủ, độ tin cậy, 3 dòng giải thích, thời gian nhận giá và thêm vào danh sách được chọn.
- Watchlist: tạo/đổi tên/xóa nhiều danh sách; thêm/xóa mã, ghi chú tối đa 2.000 ký tự, giá mục tiêu VND. Xóa danh sách cascade mã. Thêm mã trùng không ghi đè ghi chú/giá đã lưu. Giá refresh 30 giây khi tab hiển thị; điểm so với ngày xếp hạng trước, không giả điểm cũ khi chưa có.

## Mô hình và giới hạn dữ liệu

`modules/market/ranking-universe.ts` cấu hình 35 ứng viên; `SYNC_SYMBOLS` có thể ghi đè (tối đa 50/lượt). Đây là sàng lọc trên universe có BCTC, **chưa phải quét cơ bản toàn bộ 1.522 mã**. Ngân hàng/chứng khoán/bảo hiểm tiếp tục chưa được engine Phần 3 hỗ trợ.

Lọc tối thiểu: BCTC năm hợp nhất có metadata kiểm toán đã công bố; EPS năm, BVPS, lợi nhuận công ty mẹ, vốn chủ dương; giá ≥1.000 VND, vốn hóa ≥100 tỷ; kỳ tài chính không quá 550 ngày, giá đầu vào không quá 7 ngày. Dữ liệu nguồn vẫn là `provider_reported`, chưa chứng nhận PDF kiểm toán; confidence giữ giới hạn của Phần 3.

| Horizon | Trọng số                                                                 |
| ------- | ------------------------------------------------------------------------ |
| Ngày    | Động lượng 35%, volume bất thường 25%, kỹ thuật ngắn 25%, lọc cơ bản 15% |
| Tháng   | Kỹ thuật trung hạn 40%, định giá 40%, sự kiện 20%                        |
| Quý     | Graham 35%, Buffett 35%, biên an toàn bảo thủ 30%                        |

- Momentum: `clamp(50 + 5 × % thay đổi so với tham chiếu, 0, 100)`, chỉ khi có giá giao dịch VPS.
- Volume: nến cuối/mean 20 phiên trước; không dùng `lastVolume`, không suy `lot×10` thành chuỗi kỹ thuật đã xác minh.
- Kỹ thuật: SMA20/50, RSI14, MACD12/26/9. Chỉ đọc `prices_daily` có lịch và price basis đã xác minh, một nguồn/basis thống nhất; không dùng `prices_history` mang nhãn unverified.
- Định giá: biên an toàn của Graham/Buffett; lấy biên thấp hơn khi có cả hai. Mỗi mô hình chiếm nửa trọng số định giá; chỉ có một mô hình thì bao phủ 20% tổng điểm tháng, không nâng lên 40%.
- Biên an toàn quý: tối thiểu của hai mô hình, chỉ đủ khi cả hai có đầu vào.
- Sự kiện: ngày GDKHQ cổ tức và ngày tổ chức ĐHĐCĐ từ Vietcap. Không coi ngày công bố tin là ngày sự kiện, không biến AGMR (báo cáo họp) thành cuộc họp mới. Có sự kiện 31 ngày tới là tín hiệu cần theo dõi, **không dự đoán KQKD/cổ tức sẽ làm giá tăng**. Ngày KQKD cần nguồn lịch công bố riêng; chưa tự ước lượng ngày quý.
- Thiếu tiêu chí: `null`, đóng góp 0, không phân bổ lại trọng số; độ bao phủ được hiển thị. Không thêm fixture để lấp đầy Top10.
- Khi chưa có giá khớp lệnh cập nhật, có thể dùng giá **tham chiếu** VPS/KBS cho định giá, ghi nhãn rõ. Không tạo % thay đổi, momentum, volume từ tham chiếu. KBS tham chiếu lưu riêng `ranking_reference_prices`; không ghi giả nguồn VPS vào `prices_current`.

`publish_rankings` là RPC SECURITY INVOKER chỉ service_role được gọi. Cả 3 horizon/scores/rankings/run được xuất bản trong một transaction, có khóa và chặn lượt cũ ghi đè lượt mới. Lưu vị trí toàn bộ ứng viên hợp lệ, RPC đọc lấy 10 sau lọc; giữ ngày cũ để watchlist so điểm. Model là `top10-v1`, độc lập điểm cài đặt cá nhân.

## Lịch Worker (giờ Việt Nam)

| Cron UTC          | Xử lý                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `*/5 2-8 * * 1-5` | Kiểm tra lịch có nguồn; tải quote trong 09:00–11:30, 13:00–15:00                           |
| `15 8 * * 1-5`    | 15:15: sau giờ đóng được xác minh, cập nhật giá, chốt history mới, BCTC/metadata, xếp hạng |
| `0 9 * * 1-5`     | 16:00: đồng bộ phục hồi dữ liệu nguồn và chấm lại; không tự chứng nhận phiên đóng          |

Giờ bao gồm thỏa thuận sau ATC của HOSE/HNX. Guard nghỉ trưa áp dụng cả ba sàn. Cron weekday chỉ là lúc đánh thức Worker; **không** là chứng nhận ngày giao dịch. Thiếu `trading_sessions`/ngày nghỉ thì không chạy intraday/EOD. History lỗi giữ dữ liệu cũ và trạng thái degraded; không đưa OHLC sai vào scoring. `fetched_at` là thời gian nhận dữ liệu, không phải timestamp sàn.

Project thật chưa có lịch phiên và chưa có price basis lịch sử được xác minh. Vì vậy intraday/EOD có guard nhưng chưa vận hành tự động; kỹ thuật/volume sẽ báo không đủ dữ liệu. Chỉ nhập dữ liệu đã xác minh, có URL nguồn:

```bash
npm run import:evidence -- /path/calendar-events.json
```

JSON gồm hai array `sessions` và `events`. Session có `session_date`, `is_open`, `closes_at` (ISO timezone, null ngày nghỉ), `source` (URL HTTPS), `verified_at`; event có `symbol`, `kind` (`earnings/dividend/agm`), `event_date`, `title`, `source_url`, `known_at`. Không seed lịch bằng cách bỏ cuối tuần. Giá `prices_daily` cần quy trình xác minh basis/đơn vị/lịch tương ứng trước khi nhập, không đổi nhãn unverified bằng cấu hình.

## Cấu hình Auth

```bash
npm run configure:auth
```

Lệnh thêm callback production/local vào redirect allowlist, giữ các URL cũ. Google đang tắt, cần người sở hữu cung cấp OAuth client trong Supabase Dashboard → Authentication → Sign In / Providers → Google. Google Console authorized redirect URI là `https://aszceahzutkhqfpyclev.supabase.co/auth/v1/callback`; domain ứng dụng là `vn-stock-analyzer.manhhuong.workers.dev`. Không gửi secret trong chat/repo. Sau khi bật provider, nút Google đã sẵn luồng PKCE nhưng vẫn phải kiểm thử OAuth tương tác thật.

Xác nhận email/reset password phụ thuộc cấu hình SMTP/deliverability của project; không coi test email/password bằng user đã xác nhận là test gửi/nhận email.

## Kiểm tra và đồng bộ

```bash
npm run verify
npm run sync:rankings -- --migrate --refresh --metadata
NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8878 npm run build
npm run dev:market
# Terminal khác:
npm run verify:phase4:live -- --browser
# Build lại mặc định trước phát hành:
npm run verify
```

Live verifier tạo 2 Auth user tạm đã xác nhận, đăng nhập thật bằng publishable key/password, kiểm tra HTTP JWT/RLS, Top10 thật, optionally UI/multiple lists/persistence/390px/logout. `finally` xóa user tạm và dữ liệu cascade, không ghi mật khẩu/service key ra disk/log. Test local PostgreSQL kiểm tra cả ownership FK, forged owner, ghi chú/giá mục tiêu, ranking atomic/stale/filter và điểm phiên trước. Google/sending emails/source outages tách khỏi CI.

Migration cloud phải chạy trước deploy. CI chưa tự áp dụng migration. `npm run verify` PASS rồi commit/push main theo AGENTS.md; không force push, không commit file credential hay work/.

Advisor hosted không có lỗi RLS, có cảnh báo [Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Cấu hình bảo vệ mật khẩu rò rỉ của project chưa bật; không tự thay đổi gói dịch vụ.

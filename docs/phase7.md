# Phần 7 — Cảnh báo và trạng thái hệ thống

## Sử dụng

Đăng nhập → **Theo dõi** → thêm mã → **Cảnh báo**. Tạo từng quy tắc vùng mua, chốt lời, cắt lỗ, thay đổi điểm hoặc tin quan trọng; bật/tắt riêng từng quy tắc và email. Một mã trong một danh sách có thể lưu nhiều mức TP/cắt lỗ hoặc vùng mua độc lập; cùng loại/khung và cùng mức giá thì cập nhật quy tắc hiện có. Các mức TP1/TP2/TP3 không ghi đè nhau. Ngưỡng giá bằng VND, không dùng nghìn đồng.

Từ bảng vùng giá Phần 5, chọn **Tạo cảnh báo mức này** để chuyển mức có dữ liệu sang biểu mẫu. Phải chọn mã đã có trong watchlist và lưu. Vùng này là snapshot do người dùng chấp nhận, không tự cập nhật khi mô hình hoặc trailing stop thay đổi. Thiết lập trailing stop Phần 5 hiện nằm trên trình duyệt, không tự coi đó là vị thế/stop đang được đồng bộ với server. Không gửi lệnh giao dịch.

**Gửi cảnh báo thử** tạo thông báo thử riêng tài khoản; một lần/phút. Chuông hiển thị số chưa đọc; đánh dấu từng thông báo hoặc tất cả. Hộp thư phân trang 50 tin. Thông báo trong app được lưu trong DB, không phụ thuộc quyền Web Push của trình duyệt; không hứa thông báo hệ điều hành khi đóng app. Poll hộp thư 15 giây, chuông 30 giây khi tab hiện.

## Điều kiện và chống lặp

- Giá: chỉ `prices_current.last_price_vnd` dương, snapshot nhận không quá 15 phút, không tương lai; không thay bằng tham chiếu/giá đóng cửa. Lần đầu đang ở vùng có thể phát thông báo. Không lặp khi vẫn trong vùng; tái kích hoạt khi quan sát ra ngoài rồi vào lại. Nếu hai snapshot đi qua toàn vùng trong 15 phút, thông báo nói rõ không xác nhận khớp giá trong vùng. Đây là giá nhận từ VPS, không có dấu thời gian sàn đã xác minh.
- Điểm: cùng khung, model family `top10-v1`, phải đủ bằng chứng/đủ điều kiện của Phần 4–6; không quá 36 giờ, không tương lai. Lần đầu lưu mốc, lần sau so với mốc đã quan sát; chênh lệch tuyệt đối từ ngưỡng 1–100. Điểm thiếu không biến thành 0; trọng số/phương pháp có thể làm điểm đổi.
- Tin: gắn trực tiếp mã, LLM hợp lệ với bằng chứng nguyên văn, mức ảnh hưởng cao, công bố sau thời điểm tạo quy tắc, không quá 7 ngày. Nhãn là nhận định mô hình về mô tả RSS, không dự báo hướng giá. Giữ link gốc. Cursor theo thời điểm phân tích + ID, tối đa 10 tin/quy tắc/lượt; bài phân tích muộn không bị bỏ vì ngày công bố cũ.
- Khóa theo rule, kiểm tra phiên bản cấu hình và revision trạng thái trong một transaction; unique `(rule_id,event_key)`. Retry/cron chồng nhau không tạo lại thông báo. Sửa/bật lại quy tắc tăng version và lấy mốc mới. Xóa mã khỏi watchlist tự xóa quy tắc; email đang chờ của quy tắc đã xóa/tắt sẽ hủy.
- Chỉ dữ liệu của mã được theo dõi được nạp theo lô; ghi kết quả tối đa 100 quy tắc/RPC. Không gọi từng RPC cho từng mã. Từ chối tập tin >1.000 trong một lô thay vì chấm trên tập bị cắt.

## Cron và retry

Cron riêng `*/5 * * * *` kiểm tra cảnh báo, email và VPS mỗi 5 phút, cả ngoài giờ. Tách khỏi lượt RSS để giới hạn CPU/subrequest của gói Cloudflare Free không bị cộng dồn trong một invocation. Giá vẫn chỉ ingest theo lịch phiên đã xác minh; không suy ra lịch sàn bằng cách bỏ cuối tuần. Cần nâng kiến trúc chia lô/queue nếu số người dùng/quy tắc tăng vượt ngân sách của gói; không tự nâng gói.

Các cron giá 5 phút trong phiên, chốt phiên 15:15 Việt Nam, đồng bộ 16:00 Việt Nam, tin 30 phút đều qua runner chung. Có lease 10 phút, unique tác vụ/lịch chạy, chặn trùng và cho lấy lại lease đã hết hạn. Mỗi job thử tối đa 2 lần, chờ 500 ms trước lần hai. Provider có retry có giới hạn riêng cho network/429/5xx. RSS fail-closed robots/quyền sử dụng không bị vượt chặn. Job partial/degraded được ghi rõ, không coi là đầy đủ; lỗi cứng giữ dữ liệu trước đó. Log JSON chỉ gồm run ID, task, attempt, state và mã lỗi cố định; không lưu raw exception, HTTP headers, JWT hoặc payload nhà cung cấp.

`system_job_runs` giữ 30 ngày; trang hiển thị 60 lượt gần nhất. Worker bị nền tảng dừng do CPU có thể không chạy catch/finally: lease hết hạn được hiển thị **chưa ghi nhận kết thúc**, không báo thành công. Không bảo đảm retry được lỗi hard termination ngay trong cùng invocation; lần Cron sau tiếp tục với dữ liệu/trạng thái idempotent.

## Email Resend (tùy chọn)

Người dùng đã chọn Resend nhưng **chưa có khóa/domain gửi**. Cần bổ sung tại Worker gốc `vn-stock-analyzer.manhhuong.workers.dev` → Settings → Variables and Secrets:

- Secret `ALERT_EMAIL_API_KEY`: khóa Resend có quyền gửi.
- Variable `ALERT_EMAIL_FROM`: ví dụ định dạng `VN Stock <alerts@domain-da-xac-minh>`; phải là địa chỉ thuộc domain đã xác minh trong Resend. Không dùng nguyên ví dụ này.
- Người dùng bật email toàn tài khoản và email của từng quy tắc. Chỉ lấy email đã xác minh từ Supabase Auth ở server, không nhận email tùy ý từ client. Cảnh báo thử có thể yêu cầu email khi đã bật toàn tài khoản.

Outbox bền vững, tối đa 5 thư/lượt; lease 5 phút, tối đa 3 lần thử. Retry network/429/5xx theo khoảng 10, 20, 40 phút; 4xx khác dừng. Idempotency key ổn định theo notification ID, cùng payload; không gửi lại sau 23 giờ để giữ trong cửa sổ dedupe 24 giờ của Resend. Không theo redirect. Recheck opt-in, rule enabled và email đã xác minh trước mỗi lần gửi. Biên nhận **Resend đã nhận email** chỉ xác nhận API trả ID, không phải đã vào inbox; chưa có webhook theo dõi delivered/bounced.

Tài liệu API đã đối chiếu: [Send Email](https://resend.com/docs/api-reference/emails/send-email), [Idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys). Khóa không nằm trong Git, browser, logs hoặc nội dung thư. Khi chưa cấu hình, không giả gửi thành công; thông báo trong app vẫn có.

## Trang trạng thái và quyền

`/status` được bảo vệ đăng nhập như phần còn lại của ứng dụng. API trạng thái chỉ chứa thông tin vận hành an toàn để công khai: mốc mới nhất từ **bảng dữ liệu thực** (`prices_current`, `scores`, `news_feed_articles`), mốc thu RSS/phân tích riêng, log job, tình trạng từng RSS, cấu hình boolean và phép thử VPS ACB thật. GET trang không tự gọi VPS; cron kiểm tra định kỳ. Kết quả probe cũ hơn 45 phút được ghi cũ, không tự đoán API đang lỗi. Thời gian nhận dữ liệu không xác nhận timestamp sàn, EPS kỳ nào, giá adjusted hoặc chất lượng xếp hạng. Giá cũ ngoài phiên có thể bình thường; không gọi đó là downtime.

RLS cho rule, trạng thái và notification theo chủ sở hữu. Client chỉ sửa `read_at` hoặc xóa thông báo của mình; không tạo/sửa nội dung thật. FK ba cột bảo đảm mã thuộc watchlist của chính owner. Outbox chỉ service role; API trả trạng thái gửi chỉ cho ID thông báo đã qua RLS của tài khoản. Endpoint thử xác thực JWT bằng Auth `getUser`, lấy owner ở server rồi gọi RPC service-only, có kiểm tra watchlist và rate limit trong DB. Không dùng user_metadata làm quyền. Không dùng SECURITY DEFINER. Giữ nguyên bảng khung `alerts` từ Phần 1; tính năng mới dùng `watchlist_alert_rules` và `notifications`, không xóa dữ liệu cũ.

Advisor security sau migration không có lỗi mới: INFO [RLS enabled no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) cho outbox là chủ ý service-only (không cấp quyền client). Cảnh báo [leaked password protection chưa bật](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) đã có từ trước, không thay cấu hình Auth trong Phần 7.

## Kiểm tra và vận hành

- `npm run verify`: typecheck, lint/format, unit/coverage, build, gitleaks, migration và RLS trên PostgreSQL riêng.
- `npm run sync:system -- --migrate`: áp dụng migration và chạy maintenance server với quản trị trong bộ nhớ. Không in key.
- `npm run sync:system -- --production`: HMAC ngắn hạn, chạy maintenance trong Worker thật với runtime secrets; service key không được gửi qua HTTP.
- `npm run dev:market -- --jobs`: local UI/API với quản trị chỉ trong RAM để chạy thử notification endpoint; không dùng chế độ này trên cổng công khai.
- `MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:alerts:browser`: tạo hai tài khoản thật tạm, nhận thông báo thử, read/unread, rule toggle, kiểm tra RLS A/B, đối chiếu mốc dữ liệu, VPS probe và mobile; tự xóa dữ liệu thử.

Chưa có khóa/domain nên kiểm thử email hiện chỉ dùng response fixture; không coi đó là đã gửi thư thật. Các phép thử không ghi giá, tin hoặc điểm giả vào dữ liệu thị trường production.

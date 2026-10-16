# Phần 8 — Backtest và hoàn thiện

## Hai loại kết quả khác nhau

`/backtest` có lịch sử Top 10 chính thức và phần **kiểm tra giá báo cáo** riêng biệt. Không dùng kết quả giá báo cáo để khẳng định chiến lược thành công.

Lúc khảo sát 16/10/2026, database có 11.161 bar `prices_history` chưa xác minh basis, nhưng `prices_daily`, `trading_sessions`, `rankings` đều trống. Vì vậy chưa có lợi nhuận Top 10/VN-Index thực đủ điều kiện. Giao diện hiển thị số mã/mẫu và **Không đủ dữ liệu**, không giả lợi nhuận 0%. Đây là giới hạn dữ liệu còn thiếu, không được bỏ lọc chất lượng để lấp Top 10.

## Lịch sử bất biến

Trigger sau `ranking_runs` lưu ba `ranking_publications` với `recorded_at` của database, thời gian chạy nguồn, model, policy, universe, mã/tên/điểm/giải thích/phiên bản đầu vào. Chỉ tối đa 10 mã đủ chuẩn, sắp điểm giảm rồi symbol; giữ cả danh sách rỗng. Thay đổi scores, tên mã, trạng thái niêm yết về sau không thay thành viên đã lưu. Chặn UPDATE/DELETE, client chỉ SELECT; service ghi qua trigger. Retry cùng nguồn/thời điểm/khung không tạo lại.

Migration chỉ quan sát bản chạy mới nhất **tại thời điểm migration**, không tạo các Top 10 quá khứ. `recorded_at` là lúc transaction bắt đầu ghi nhận, không chứng nhận từng người đã xem; mua từ ngày tiếp theo là giả định bảo thủ. Phần này chỉ theo mô hình mặc định đã công bố, không backtest bộ lọc/trọng số cá nhân thay đổi ở thời điểm xem. `source_run_at` và giải thích lưu trọng số tin/chiến lược của lần tính đó.

## Công thức và phiên giao dịch

- Mua giá **mở cửa** phiên xác minh đầu tiên sau ngày `recorded_at` tại Việt Nam. Không mua giá đóng cửa trước khi tín hiệu tồn tại.
- 1 ngày: bán đóng cửa ngay phiên mua. 1 tháng/1 quý: ngày đủ 1/3 tháng lịch từ phiên mua, chặn tràn cuối tháng; bán đóng cửa phiên mở đầu tiên từ ngày đó. Tối đa tìm 7 ngày cho mỗi đầu mốc, không tự đoán cuối tuần/ngày nghỉ. Lịch giữa mốc và phiên được chọn phải liên tục, gồm ngày đóng cửa. Phiên bán chưa đóng thì chưa có kết quả.
- Giá chính thức: `prices_daily.price_basis=adjusted`, entry/exit cùng source. Không trộn `prices_history` chưa xác minh. Dữ liệu xác minh do quy trình nhập dữ liệu chịu trách nhiệm; enum không tự chứng minh tính đúng đắn. Thay đổi phương pháp điều chỉnh của nhà cung cấp vẫn là rủi ro. Không khẳng định đây là total return tái đầu tư cổ tức.
- Mỗi mã: `(giá bán / giá mua − 1) × 100`. Danh mục: trung bình lợi nhuận với trọng số vốn ban đầu bằng nhau. Tỷ lệ thắng = số mã lợi nhuận > 0 / toàn bộ mã × 100; hòa vốn không tính thắng. Không tái cân bằng/ghép lãi kép các snapshot chồng lấn.
- Thiếu giá bất kỳ thành viên nào: **không** chuẩn hóa trọng số trên các mã còn lại. Có số mẫu có giá để thấy độ phủ, nhưng lợi nhuận/tỷ lệ thắng toàn danh sách là null. Danh sách rỗng không phải danh mục tiền mặt 0%.
- VN-Index: `market_index_daily` chứa điểm mở/đóng (không phải VND), source + URL + verified_at, cùng ngày mua/bán cổ phiếu và cùng nguồn index. Thiếu index không xóa lợi nhuận cổ phiếu; so sánh và chênh lệch là null. Chênh lệch là **điểm phần trăm**, không phải tỷ lệ tương đối.
- Chưa tính phí, thuế, spread, trượt giá, tác động thanh khoản, giới hạn khối lượng và không bảo đảm khớp ở giá mở/đóng khi trần/sàn. Không dùng để giả định có thể thực thi giao dịch thật.

Look-ahead bias còn có thể xảy ra khi dữ liệu tài chính được điều chỉnh/công bố lại hoặc người vận hành nhập sai `known_at`. Thiên lệch sống sót do universe thu thập hiện tại có thể thiếu mã đã hủy niêm yết. Lưu thành viên giúp tránh loại mã biến mất sau công bố; không khôi phục universe lịch sử chưa thu thập. Giao diện nêu rõ các hạn chế này.

## Kiểm tra giá báo cáo

Dùng một mã/ngày bắt đầu/nguồn do người dùng chọn. Lấy open bar đầu tiên từ ngày chọn và close bar đầu tiên ở mốc 0/1/3 tháng, mỗi mốc tối đa lệch 7 ngày. Chỉ bar trước ngày Việt Nam hiện tại. Chưa xác minh finality/basis/lịch; chia tách hoặc cổ tức có thể tạo biến động giả. Không tự chọn mã theo lợi nhuận, không tính tỷ lệ thắng chiến lược và không tạo VN-Index giả. Giá VND; có ngày/giá/nguồn để đối chiếu lại biểu đồ.

## Bổ sung dữ liệu thật

1. Nhập lịch có nguồn (cả ngày mở và đóng) qua `npm run import:evidence -- /path/calendar-events.json`, schema tại [phase4.md](phase4.md). Không sinh lịch bằng cách bỏ cuối tuần.
2. Xác minh đơn vị VND, cơ sở điều chỉnh, phương pháp xử lý corporate actions và finality từ nhà cung cấp trước khi ghi `prices_daily`. Không UPDATE nhãn các bar unverified để qua kiểm tra.
3. Nhập mức VN-Index có nguồn kiểm chứng bằng service role vào `market_index_daily`; symbol `VNINDEX`, session_date có trong lịch, open_points/close_points > 0, source, source_url HTTPS, verified_at. Không có feed VN-Index được xác minh trong repo nên chưa bật ingest tự động. Không ghi index thành một mã cổ phiếu.
4. Bổ sung bằng chứng đầu vào để Top 10 đạt `complete-v1`, tính lại bằng `npm run sync:rankings`. Chỉ các lần công bố từ lúc tính năng hoạt động mới được quan sát.
5. Chờ đủ các kỳ; trang sẽ tự tính lại theo dữ liệu đã xác minh, không cần backfill điểm từ thông tin tương lai.

## Hiệu năng và bảo mật

- Một RPC `backtest_history` lấy tối đa 10 bản và các giá đầu/cuối; chỉ truy vấn theo stock/date/basis có index. Cursor `(recorded_at,id)` ổn định, không OFFSET tăng dần; dữ liệu mới không làm trượt trang cũ. Lịch sử giữ các lần công bố, không nạp toàn bộ lịch sử OHLC về browser.
- Cache edge dạng named Cache API cho GET công khai `/v1/backtest` 60 giây, `/v1/rankings` và tìm kiếm `/v1/stocks` theo TTL của API. Chỉ 200, không Set-Cookie; bỏ cache request có Authorization/Cookie. Không cache status, watchlist, thông báo, Auth hay cài đặt. Cache hỏng vẫn đọc database; response lỗi không được cache. Cache theo data center, không bảo đảm HIT trên workers.dev; có `X-Data-Cache` để kiểm tra. PWA tiếp tục không cache API/dữ liệu cá nhân.
- Rate binding `API_RATE_LIMIT` 120 yêu cầu/phút/IP và `ANALYSIS_RATE_LIMIT` 30/phút/IP cho backtest/BCTC; trả 429 + Retry-After 60, no-store trước database/provider. Đây là bộ đếm xấp xỉ **theo Cloudflare location**, không phải quota toàn cầu hay bảo vệ Supabase Data API được gọi trực tiếp. CF-Connecting-IP chỉ đáng tin khi đi qua Cloudflare. Binding chưa có trong adapter local/fixture thì không mô phỏng bảo vệ production; cấu hình production phải có cả hai.
- Internal jobs vẫn xác thực HMAC, không cạnh tranh quota với browser. Cảnh báo thử còn rate limit một lần/phút/tài khoản trong DB.
- RLS đọc công khai lịch sử/index; client không sửa kết quả thị trường. Cài đặt rủi ro theo owner, kiểm tra JSON tại DB và TypeScript. Các bảng service-only vẫn deny client; không thêm SECURITY DEFINER.
- Response thêm nosniff, DENY iframe, strict-origin referrer và tắt camera/microphone/geolocation. Không thêm CSP chưa kiểm thử làm hỏng OAuth/Next.
- Advisor Auth đã có cảnh báo leaked password protection chưa bật; không tự nâng gói hay thay cấu hình email/Google. Gitleaks nằm trong verify. Không in token/secret/service role vào browser hoặc log.

## Cài đặt

Graham/Buffett và giả định DCF giữ cơ chế lưu Supabase/RLS. Thêm `risk_preferences`: maxLoss mặc định 8%, ATR ×2, stopMethod ATR, trailingPercent 8%. Giá trị mặc định tài khoản chỉ áp dụng cho mã **chưa có** kế hoạch riêng trên trình duyệt. Không di chuyển vị thế/high-water/trailing đã lưu hoặc tự sửa cảnh báo server. Tài khoản khác không kế thừa ngưỡng; việc lưu risk không ghi đè scoring_preferences và ngược lại.

## Kiểm chứng

`npm run verify` gồm các phép tính tay (+10%, +20%/−10%/0%, chỉ số +5%), mẫu thiếu/0, SQL cuối tháng/next-open/index/calendar gap, snapshot bất biến, RLS A/B, rate limit 429 và cache không chạm dữ liệu cá nhân. Fixture chỉ chạy PostgreSQL riêng, không nhập thị trường giả vào production.

`npm run verify:backtest:browser` tạo hai tài khoản thử thật, kiểm tra login gate/backtest thiếu dữ liệu đúng, đối chiếu diagnostic với giá DB, lưu risk trên UI và kiểm tra RLS, mobile 390px/theme; tự xóa người dùng thử. Production: `MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:backtest:browser`. Chưa đủ dữ liệu để coi các fixture là backtest lợi nhuận thật của chiến lược.

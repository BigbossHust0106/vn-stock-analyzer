# Top10 và cập nhật snapshot giá — 16/10/2026

## Nguyên nhân đã xác minh

API production `/v1/rankings?horizon=day` trả `data=[]`, `excluded` có23 mã.
Giao diện tự mở bảng audit khi không có mã đạt điều kiện, nên23 mã chưa đủ bằng
chứng xuất hiện dưới tiêu đề Top10. API đã giới hạn10 mã đủ điều kiện; lỗi hiển
thị nằm ở việc đưa bảng audit vào cùng trang. Không biến23 mã đó thành10 khuyến
nghị khi đầu vào chưa đạt yêu cầu.

Supabase `trading_sessions` trống trong lần kiểm tra. Cron giao dịch đã xác minh
bỏ chạy theo thiết kế. FPT còn snapshot nhận14/10; việc poll DB mỗi30 giây không
tự tạo quote mới. Làm mới nền có timeout5 giây, trong khi probe VPS có lúc hơn7
giây và có HTTP503 xen kẽ200.

## Hành vi mới

- Cả ngày/tháng/quý chỉ có bảng xếp hạng tối đa10 mã duy nhất. Không render bảng
  audit phía dưới; không tự mở23 mã bị loại. Nếu không đủ10 mã đạt yêu cầu, ghi
  rõ số lượng, không dùng điểm tạm hay dữ liệu mẫu để lấp đầy.
- API và client đều chặn10 dòng, loại trùng mã/ID. Bộ lọc vẫn chạy trước giới hạn
  phía API. Điều kiện coverage, bằng chứng giá, tài chính và tin tức được giữ.
- Top10/watchlist gọi một batch giá công khai mỗi10 giây khi trang đang hiện và
  có mạng; request chưa xong thì không chồng thêm. Điểm/bộ lọc kiểm tra lại mỗi
  phút, có thời điểm tính riêng. Cron tính lại điểm/xếp hạng mỗi5 phút sau
  lượt snapshot có dữ liệu trong khung theo dõi; không tải lại BCTC mỗi lượt. Giá mới không giả làm điểm vừa tính lại.
- Chi tiết mã kiểm tra summary mỗi10 giây; trả snapshot nhanh và làm mới nền khi
  cần. Chart vẫn chỉ tải khi được bật. Trở lại tab, focus hoặc có mạng lại sẽ kiểm
  tra ngay; unmount dọn timer/listener và hủy request.
- `/v1/quotes` đọc catalog bằng publishable key, chỉ lấy mã active đã tồn tại,
  gọi VPS thật rồi lưu bằng RPC server. Giá VND và `lot*10` giữ đúng adapter đã
  kiểm chứng; không chuẩn hóa `lastVolume`. Không đọc dữ liệu cá nhân bằng key ghi.
- Cache provider5 giây, gộp batch đang chạy; tối đa2 batch chờ trong isolate,
  request cách nhau tối thiểu1 giây, timeout12 giây, không retry ngay trong HTTP
  request. Nguồn lỗi cooldown10 giây; lượt poll tiếp theo thử lại. Giới hạn API
  hiện có vẫn áp dụng; đây không phải quota toàn hệ thống của VPS.
- Summary/quotes/rankings trả `no-store`; rankings được loại khỏi edge-cache để
  không phục vụ lại entry cũ. Không cache giá trong service worker PWA.
- Cron `* 2-8 * * 1-5` lấy snapshot universe cấu hình mỗi phút, từng batch10 mã,
  cô lập lỗi giữa các batch. Đây là khung giờ **lấy mẫu**, không phải chứng nhận
  lịch phiên. Dừng cuối tuần, ngoài9:00–15:00 giờ Việt Nam và giờ nghỉ11:30–13:00;
  lịch đã xác nhận nghỉ thì bỏ tải. Thiếu lịch vẫn được tải **snapshot hiển thị**,
  nhưng trạng thái degraded/CALENDAR_MISSING; không tạo lịch, OHLCV, chốt phiên,
  chứng nhận timestamp hay điểm từ giả định. Cron EOD/ingest đã xác minh vẫn
  giữ guard lịch và không được nới. Universe mặc định35 mã, không tuyên bố đã
  đồng bộ giá toàn bộ thị trường mỗi phút. Mã khác được cập nhật khi tra cứu/theo dõi.

## Tính mới và giới hạn thực tế

`fetchedAt` là lúc nhận phản hồi VPS, **không phải thời gian phát sinh tại sàn**.
`checkedAt` chỉ là lúc kiểm tra request; không thay `fetchedAt` của snapshot cũ.
API giữ `sourceTimestamp=null`, `sessionVerified=false`. Một giá đứng yên không
chứng minh nguồn lỗi hay nguồn vừa có giao dịch; không gắn nhãn tick real-time.
Nguồn không chính thức có thể503/chậm/chặn; polling không đảm bảo SLA hay feed
trực tiếp từng lệnh. Khi lỗi giữ giá và thời điểm cũ, cảnh báo và tự thử lại.
Nếu cần cam kết cập nhật từng tick, phải có feed được cấp phép/SLA.

Trong thử thật: batch universe có phần thành công/phần503; snapshot VNM nhận
16/10/2026 10:41:41 giờ Việt Nam, giá57800 VND. `/v1/quotes` mới đã nhận/lưu FPT
10:43:09, giá58400 VND. Lượt HPG và VNM sau đó trả trạng thái source_unavailable
và giữ timestamp cũ đúng thiết kế. Không tuyên bố tất cả mã đã nhận phản hồi mới
trong lượt lỗi này. Đây là quan sát thời điểm kiểm tra, không số liệu hard-code.

## Kiểm tra hồi quy

-23 ứng viên đủ điều kiện + bản ghi trùng: từng kỳ trả đúng10 mã cao nhất,
điểm22..13 theo đáp án độc lập; mã không đủ điều kiện vẫn bị loại.
-Client nhận23 dòng từ API cũ vẫn chỉ render10, không gộp excluded.
-Cache/coalescing/hết hạn/lỗi nguồn/cooldown và không lùi UI về snapshot cũ hơn; quyền đọc/ghi và đơn vị ACB20450
VND,7969100 CP; lỗi nguồn không ghi giá/thời điểm giả.
-Ngày nghỉ đã xác nhận/giờ nghỉ/cuối tuần/ngoài giờ không lấy mẫu; thiếu lịch chỉ
ghi snapshot, không ghi bars/rankings và báo degraded.
-Polling không chồng request, dừng khi ẩn/offline, chạy khi focus/online, dọn listener.
\-`scripts/browser-live-rankings.ts`: mock23+23 dòng, cả3 kỳ chỉ10; giá21000→22000
và +5%→+10% với tham chiếu20000, không reload; điểm90 không đổi; lỗi nguồn giữ
giá22000 và cảnh báo. Mock chỉ ở browser test, không ghi production.

Chạy `npm run verify`; `npm run dev:market` rồi `node --import tsx
scripts/browser-live-rankings.ts` trong môi trường Playwright có CA/proxy và quyền
quản trị Supabase cho tài khoản thử. Log verify nguyên văn đi kèm bản bàn giao.

Tự kiểm tra production: mở `/top10`, đổi3 kỳ và bộ lọc; chỉ bảng tối đa10 mã đạt
điều kiện. Nếu0 mã đạt, giao diện phải nói rõ. Mở FPT/VNM/HPG, xem thời điểm nhận;
DevTools Network phải có summary/quotes lặp khi tab hiện, không tải nến nếu chưa
bật. Tắt/bật mạng để kiểm tra cảnh báo, giữ giá và tiếp tục cập nhật.

## Kết quả lần kiểm tra cuối

`npm run verify`:9/9 PASS,188 unit PASS,42 provider PASS và1 TODO cũ về
`lastVolume`;18 migration PostgreSQL và RLS PASS. Log nguyên văn:
[verify-top10-live-2026-10-16.txt](verify-top10-live-2026-10-16.txt).
Browser Top10/polling và hồi quy PWA PASS:
[browser-top10-live-2026-10-16.txt](browser-top10-live-2026-10-16.txt).

Sau các lượt503, kiểm tra lại16/10/2026 đã nhận/lưu được cả3 mã:
FPT58400 VND lúc10:47:38; HPG20800 VND lúc10:47:40;
VNM57800 VND lúc10:47:41 (giờ Việt Nam). API trả
`source_response,persisted=true,sourceTimestamp=null,sessionVerified=false`.
Đó là bằng chứng phục hồi kết nối; không cam kết mọi lượt polling luôn thành công.

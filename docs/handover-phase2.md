# Bàn giao Phần 2 — 13/10/2026

## ĐÃ XÁC MINH BẰNG MÁY

- `npm run verify`: cả 9 bước PASS. [Nguyên văn toàn bộ log](verify-phase2-2026-10-13.txt), không chỉnh thời gian/số liệu/kết quả.
- Vitest: 58 unit tests PASS; provider 20 PASS, 1 TODO về `lastVolume` chưa có đối chiếu. TODO không được tính là PASS.
- Coverage tài chính: statements/functions/lines 100%, branches 97,75%, vượt ngưỡng 80% cho strategies/scoring.
- PostgreSQL 17: cả 3 migration PASS; public đọc history, anon không ghi/gọi ingest, RPC chống dữ liệu cũ ghi đè. RLS A/B chặn đọc/ghi dữ liệu của người khác.
- Supabase thật: 3 migration đã áp dụng, 1.522 mã, 2.238 bar (746/mã VNM/FPT/HPG từ 2023-10-13 đến 2026-10-13), 3 snapshot ban đầu. Đã đọc lại số lượng qua Management API. Không seed fixture production.
- `npm run smoke`: HTTP web/Worker 200, input sai 400, thiếu cấu hình 503.
- `npm run verify:browser:live`: Chromium dùng HTTP/Supabase/VPS thật, không mock. Kết quả nguyên văn:

```text
BROWSER LIVE PASS: VNM, 57.900 VND, search → detail, canvas, 1D/1W/1M, MA/volume
BROWSER LIVE PASS: FPT, 56.700 VND, search → detail, canvas, 1D/1W/1M, MA/volume
BROWSER LIVE PASS: HPG, 20.550 VND, search → detail, canvas, 1D/1W/1M, MA/volume
BROWSER LIVE PASS: Enter mở đúng VNM
BROWSER LIVE PASS: 390px responsive, theme toggle/reload, no JS errors
```

Giá trên là snapshot lúc chạy test, không phải mức giá cố định.

## CHƯA XÁC MINH / GIẢ ĐỊNH

- Basis adjusted/unadjusted của history, quota chính thức, quyền phân phối và timestamp sàn. Ghi rõ `unverified`, không đưa vào chấm điểm.
- Đơn vị quote `lot × 10` mới có bằng chứng ACB một ngày; `lastVolume` giữ raw và TODO. History `v` đã đối soát cổ phiếu trên VNM/FPT/HPG một phiên, không nhân 10.
- VPS catalog không có phản hồi hợp lệ trong khảo sát; catalog dùng KBS đã gọi thật. VpsProvider báo capability chưa hỗ trợ, không đoán schema.
- BCTC/mapping EPS annual-TTM/BVPS/FCFE, lịch nghỉ lễ và giờ đóng phiên có nguồn vẫn thiếu. Không tự tạo endpoint/lịch/bar.
- RLS test local không thay thế Supabase Auth/JWT HTTP với hai người dùng thật.
- Lúc chuẩn bị commit, token Cloudflare hiện có thuộc namespace `stockanalysis-dce`; không có quyền xác nhận trực tiếp triển khai vào `manhhuong` bằng token đó. Kiểm tra site sau push độc lập với kết quả verify local.

## LỖI TỰ TÌM THẤY VÀ ĐÃ SỬA

- PostgreSQL readiness từng nhận nhầm server tạm lúc init; probe TCP final server trước khi chạy SQL.
- Cron từng có thể bỏ qua history rỗng và báo success; giờ lỗi ngay. CLI cho phép chuỗi hợp lệ ngắn hơn MA200, chỉ từ chối history rỗng; UI ghi rõ thiếu nến MA.
- Giá giảm VPS có trường mức thay đổi dạng trị tuyệt đối; UI tính dấu từ last/reference và chống chia 0/tràn số.
- Volume label từng lẫn trên trục giá; tách scale và ẩn last-value label của volume.
- Query đổi mã có thể giữ dữ liệu cũ; keyed detail/AbortController và kiểm tra abort trước set state ngăn ghi kết quả cũ.
- MA phải tính trên toàn bộ chuỗi trước zoom; không lấy cửa sổ 1 tháng để tính MA200. Test SMA đối chiếu thư viện và đáp án tính tay.
- Tên miền hiện có chỉ phục vụ API; thêm Workers Static Assets để deploy giao diện cùng URL. Actions có mode worker-only, Pages không bắt buộc.
- Đối chiếu lại Graham sqrt(22.5×EPS×BVPS), MOS 1−price/intrinsic, DCF FCFE/Gordon, RSI/ATR Wilder, MACD EMA và Fibonacci retracement từ đỉnh. Không đổi công thức/đáp án Phần 1, các test vẫn PASS. Không dùng EPS quý như EPS năm.
- Rà soát key/SQL/RLS: không commit key thật; RPC SECURITY INVOKER, empty search_path, quyền ghi chỉ service_role; JSON SQL escape dấu nháy; endpoint HTTP chỉ đọc thị trường đã đăng ký. Gitleaks PASS.

## RỦI RO CÒN LẠI

- Endpoint không chính thức có thể bị chặn/đổi schema. Hiển thị lỗi hoặc snapshot đã lưu có thời điểm; không tạo giá thay thế.
- Rate limit/cache thuộc từng isolate, chưa có giới hạn tổng toàn hệ thống. Cache history 15 phút có thể khác quote 15 giây; UI hiển thị riêng thời điểm hai nguồn.
- Catalog đồng bộ toàn bộ, history/quote định kỳ chỉ nhóm SYNC_SYMBOLS mặc định VNM/FPT/HPG; mã khác lấy khi mở trang. Đây không phải đồng bộ history toàn bộ 1.522 mã.
- Snapshot/history hôm nay chưa chứng nhận giá cuối phiên; không tự bù cuối tuần/ngày nghỉ hoặc suy lịch từ bar.
- Chưa chạy cron tự động trên Cloudflare bằng token đúng account, chưa xác minh ruleset chặn merge đỏ. Deployment cần kiểm tra riêng sau push.

## CÁCH TÔI TỰ KIỂM TRA

1. `npm ci`, `npm run tools:install`, `npm run verify`, `npm run smoke` (Node 24, Docker).
2. Đọc [data-sources.md](data-sources.md) và fixture tests; chạy `npm run verify:live` riêng để gọi VPS.
3. Cấp Supabase Management token qua secrets rồi `npm run sync:market -- --migrate`; lần sau migration được bỏ qua theo version. Xem public `stocks`, `prices_history`, `prices_current` trong Supabase.
4. `npm run build`, đặt public URL/key trong ignored `.cache/connection.env`, `npm run dev:market`; terminal khác cài Chromium theo README và `npm run verify:browser:live`.
5. Sau deploy URL cũ: mở trang chủ, nhập VNM/FPT/HPG, đổi ngày/tuần/tháng, bật sáng/tối. `GET /v1/stocks/VNM` phải trả history và quote thật; lỗi nguồn phải có thông báo rõ. Có thể đặt `MARKET_APP_URL` để chạy browser test trên site thật.
6. Cloudflare Workers Builds: root repo, build `npm run build`, deploy `npx wrangler deploy`, Node 24. Giữ đúng account/namespace `manhhuong`; secrets Supabase chỉ ở Worker. GitHub Actions dùng mode `actions` hoặc `git-integration` theo README, kiểm tra check `verify` và ruleset `main`.

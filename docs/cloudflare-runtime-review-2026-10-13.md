# Kiểm tra triển khai Cloudflare — 13/10/2026

## Account và bảo mật

Token được cấp trong phiên hợp lệ (`user/tokens/verify` HTTP 200, active).
Account ID ban đầu trả HTTP 403. Qua API accounts/subdomain, xác nhận account
`9a0d6d0c169959b70222e98819280fe7` có namespace `manhhuong`.
Giữ URL `https://vn-stock-analyzer.manhhuong.workers.dev`.
Account ID là định danh công khai, không phải API token; token không được lưu vào repo.

Đã thêm `SUPABASE_SERVICE_ROLE_KEY` vào Cloudflare **Secret** cho Worker, lấy
trong bộ nhớ từ đúng project qua Supabase Management API, kiểm tra JWT role/ref/expiry.
Không in hoặc lưu giá trị vào file/bundle/browser. Public URL/key runtime có sẵn được giữ.

## Lỗi phát hiện trên runtime thật

Deploy đầu thành công và các route trả 200 nhưng provider fallback dữ liệu đã lưu.
Probe Cloudflare biệt lập tái hiện hai lỗi (không can thiệp URL ứng dụng):

```text
Illegal invocation: function called with incorrect `this` reference.
Invalid redirect value, must be one of "follow" or "manual"
```

Provider HTTP đã sửa receiver `globalThis` và dùng redirect `manual`.
Phản hồi 3xx được từ chối, không theo hostname tùy ý. Có test hồi quy tái hiện
đúng ràng buộc này; không thay đáp án các công thức tài chính.

## Tự kiểm tra và cấu hình lâu dài

`npm run verify` bao gồm test mới. Mở URL cũ, tìm VNM/FPT/HPG; API chi tiết
phải trả giá, history và thời điểm nhận dữ liệu, không có notices fallback trong
lần kiểm tra nguồn khỏe. `MARKET_APP_URL` chọn site cho browser live test ngoài CI.

Đặt token đúng account và Account ID trên vào **Environment Secrets** để phiên
sau sử dụng; token nhập trong chat chỉ dùng cho thao tác phiên này.
Nếu dùng GitHub Actions CD, cấu hình các secret cùng tên ở GitHub và
`CF_DEPLOYMENT_MODE=actions`; nếu dùng Workers Builds chọn `git-integration`.
Token đã xuất hiện trong chat nên thay bằng token mới qua nơi nhập secrets an toàn.

## Kết quả sau bản sửa

- `npm run verify`: 9/9 PASS; 58 unit tests, 22 provider tests PASS; 1 TODO đơn vị lastVolume theo bằng chứng còn thiếu. Log nguyên văn: [verify-cloudflare-2026-10-13.txt](verify-cloudflare-2026-10-13.txt).
- API VNM/FPT/HPG: HTTP 200, 746 bar/mã, quote nhận mới, notices rỗng. Đọc lại Supabase xác nhận snapshot ghi bởi Worker trùng giá/thời điểm nhận từ API.
- Browser trên **URL production thật**, không mock hoặc proxy ứng dụng: PASS. Chromium chạy trong container Playwright chính thức pin digest `sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f`, kho NSS riêng chỉ dùng CA proxy do môi trường cung cấp; không tắt xác minh TLS, không sửa kho CA chung. Container đã tự xóa; Worker chẩn đoán tạm cũng đã xóa.
- Cron đã được cấu hình 15:30 và 16:00 giờ Việt Nam; chưa xác minh một lượt cron tự chạy đến đúng lịch. Cron cũ vẫn cần trading_sessions đã xác minh.

```text
BROWSER LIVE PASS: VNM, 57.700 VND, search → detail, canvas, 1D/1W/1M, MA/volume
BROWSER LIVE PASS: FPT, 56.700 VND, search → detail, canvas, 1D/1W/1M, MA/volume
BROWSER LIVE PASS: HPG, 20.500 VND, search → detail, canvas, 1D/1W/1M, MA/volume
BROWSER LIVE PASS: Enter mở đúng VNM
BROWSER LIVE PASS: Sữa Việt Nam + Enter mở đúng VNM
BROWSER LIVE PASS: 390px responsive, theme toggle/reload, no JS errors
```

Các giá là snapshot lúc chạy, không phải đáp án cố định hay chứng nhận giá cuối phiên.

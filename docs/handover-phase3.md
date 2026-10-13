# Bàn giao Phần 3 — engine chấm điểm

## ĐÃ XÁC MINH BẰNG MÁY

- `npm run verify`: 9/9 PASS; log nguyên văn tại [verify-phase3-2026-10-13.txt](verify-phase3-2026-10-13.txt).
- 72 unit tests PASS; coverage strategies/scoring: 100% statements/functions/lines,
  98,92% branches tổng. Graham/DCF/biên an toàn có đáp án tính tay độc lập; không sửa đáp án để khớp code.
- 31 provider tests PASS; 1 TODO từ Phần 1: `lastVolume` VPS chưa có số đối chiếu.
- `npm run smoke`: web/worker200, input400, config thiếu503.
- `npm run verify:financials:live`: VNM/FPT/HPG mỗi mã 4 năm2022–2025, đúng EPS năm4028/5216/1973 VND.
- `npm run sync:financials -- --migrate`: migration4 chạy thật trên project Supabase
  `aszceahzutkhqfpyclev`; 12 dòng fundamentals, 3 financial_snapshots và 3 điểm mặc định.
  Chạy lại sau sửa chuyển numeric/timestamp từ Management API đã PASS.
- `npm run verify:settings:live`: 2 user Auth/password/JWT thật, B lưu70/30, A không đọc,
  sửa hoặc giả owner B; xóa cả2 user và preferences cascade sau test.
- Chromium/Playwright trên app local dùng DB/provider thật: VNM/FPT/HPG có điểm,
  hai module/tiêu chí/giá trị nội tại/MOS/bảng BCTC; đổi100/0 rồi reload đúng Graham;
  mobile390px không tràn, không có JS errors. Không mock nguồn trong browser test.
- Deployed Worker+assets giữ namespace `manhhuong.workers.dev`; version
  `187972e3-cba7-44d5-acc6-a42e0929b577`. API financials production200/4 năm mỗi mã.
  Kiểm tra browser production có cùng các phép kiểm tra local. TLS được giữ bật,
  CA môi trường chỉ nằm trong NSS isolated của Docker tạm thời.

## CHƯA XÁC MINH / GIẢ ĐỊNH

- Metadata nhà cung cấp nói kiểm toán/hợp nhất; chưa đối chiếu mọi chỉ tiêu với PDF gốc.
  Đã đối chiếu VNM2025 KBS/Vietcap: EPS khớp, số tiền lệch dưới1000 VND do raw nghìn.
- ROIC theo Vietcap RATIO_YEAR; định nghĩa vốn đầu tư chưa được chứng nhận từ báo cáo gốc.
- DCF là proxy CFO−Capex duy trì giả định; chưa có maintenance Capex thực và tiền thuộc
  riêng CĐ mẹ. Không gọi FCF này là FCFE/Owner Earnings đã xác minh.
- Chuỗi3 năm rút gọn, chưa thay thế Graham10 năm lợi nhuận/20 năm cổ tức.
- Snapshot số CP mới nhất chưa chứng nhận biến động sau kỳ đó; FPT/HPG thay đổi so với
  cuối2025 nên Graham định giá bị khóa, không tự scale EPS/BVPS.
- Browser xác minh settings khách; chưa chạy UI login bằng tài khoản cá nhân người dùng.
  Backend hosted password/JWT/RLS đã chạy thật bằng user tạm.
- Cron16:00 Việt Nam đã cấu hình; chưa quan sát một lần trigger lịch tự chạy bản mới.
  Không đoán ngày nghỉ lễ/phiên từ thứ trong tuần; BCTC không thêm bar giá ngày không phiên.

## LỖI TỰ TÌM THẤY VÀ ĐÃ SỬA

- KBS CSTC chia Content thành nhiều nhóm: parser ghép nhóm, không yêu cầu một nhóm.
- Vietcap RATIO_YEAR quarter=5 khác RATIO_TTM quarter1–4: lọc đúng annual, không thay ROIC
  bằng ROCE và không nhận quý chưa kết thúc.
- EPS năm VND khác monetary rows nghìn VND; giữ EPS, scale riêng dòng tiền.
- BVPS KBS gồm NCI: tính BVPS mẹ bằng equity−NCI/số CP năm; cổ tức tập đoàn có NCI
  trả thiếu dữ liệu cho tiêu chí cổ tức mẹ.
- Management API numeric string / timestamp PostgreSQL làm confidence sai: query chuẩn
  float8 và ISO UTC trước chấm điểm, đã chạy lại sync và kiểm tra kết quả thật.
- Giá0 không được coi là P/E/P/B hợp lệ; missing không làm NaN hoặc tăng coverage.
- RPC khóa stock để payload cũ không ghi đè; trigger scores từ chối inputs/computation cũ.
- Cài đặt local được tách key guest/owner, đăng nhập đọc preference theo owner, logout về
  mặc định; SQL constraint chặn weights sai/DCF chia0. RLS kiểm thử cả PostgreSQL và hosted.
- Wrangler mặc định xóa Dashboard vars: `keep_vars=true` bảo toàn cấu hình Supabase
  công khai khi Cloudflare tự deploy sau push; private key tiếp tục ở secrets.
- Trang settings chờ khởi tạo Auth/preference rồi mới bật form: sửa race được phát hiện
  khi browser production lưu trọng số giữa lúc hydrate, tránh ghi đè giá trị vừa nhập.
- Selector browser ban đầu chạm table của chart: thu hẹp `.financial-table table`, giữ
  kiểm tra nội dung; không sửa đáp án tài chính. Lint cleanup finally sửa để giữ lỗi test gốc.

## RỦI RO CÒN LẠI

- KBS/Vietcap là API web không chính thức, có thể đổi/chặn, chưa có SLA/quota/quyền
  phân phối dữ liệu được xác nhận. Cache/rate limit mỗi isolate, không phải toàn hệ thống.
- Mô hình v1 chỉ doanh nghiệp phi tài chính, năm lịch, báo cáo hợp nhất đã kiểm toán theo
  metadata. BCTC thiếu không tự điền0; ngân hàng/chứng khoán/bảo hiểm chưa áp dụng.
- DCF nhạy với assumptions/NCI; confidence bằng mức hoàn thiện bằng chứng, không phải
  xác suất sinh lời. Nguồn hiện tại bị giới hạn65%, kết luận **Quan sát**, không tự tạo Mua.
- Chỉ đồng bộ sẵn VNM/FPT/HPG; mã khác lazy-load theo capability của nguồn. Dữ liệu hồi tố
  không dùng backtest point-in-time. Giá/history và đơn vị lastVolume vẫn có giới hạn Phần2.
- GitHub Actions verify phải xanh trước merge; cấu hình CD Actions vẫn phụ thuộc vars/secrets
  GitHub đã có. Deploy trực tiếp Cloudflare đã thực hiện; không đồng nhất với publish môi trường.

## CÁCH TÔI TỰ KIỂM TRA

1. Mở `/stocks?symbol=VNM`, FPT, HPG trên
   [ứng dụng](https://vn-stock-analyzer.manhhuong.workers.dev/); xem hai điểm, tiêu chí,
   MOS/giá trị và BCTC năm. FPT/HPG Graham định giá hiển thị thiếu dữ liệu do số CP đổi.
2. Mở `/settings`, đổi Graham100/Buffett0, lưu và reload. Tổng phải bằng điểm Graham.
   Khi có tài khoản Supabase Auth đã xác nhận, đăng nhập để lưu preference theo tài khoản.
3. Local: `npm ci && npm run tools:install && npm run verify` (Node24, Docker).
4. `npm run verify:financials:live` gọi nguồn thật, tách CI. `npm run sync:financials -- --migrate`
   cần SUPABASE_ACCESS_TOKEN/PROJECT_REF qua Environment Secrets; không gửi token trong chat.
5. `npm run verify:settings:live` tạo/xóa2 user test hosted, cần quyền quản trị; không chạy CI.
6. `MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:scoring:browser`
   cần Playwright/Chromium. Cloud managed dùng Docker official với NSS CA isolated như Phần2.

Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.

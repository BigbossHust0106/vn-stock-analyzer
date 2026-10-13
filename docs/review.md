# Tự review Phần 1 trước bàn giao — 12/10/2026

Đã chạy `npm run verify` trước khi review. Log nguyên văn lần chạy cuối:
`.cache/verify.log`; summary có runId ở `.cache/verify-summary.json`.
Đây là tự review theo vai reviewer, không khẳng định có một người độc lập kiểm toán.

## Checklist

| Mục                        | Kết luận / giới hạn                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Graham Number              | sqrt(22.5 × EPS năm/TTM × BVPS), test tính tay 47.4341649025, adapter từ chối EPS quý                                                    |
| Biên an toàn               | 1 - giá thị trường / nội tại; âm là hợp lệ, input/mẫu số phải dương hữu hạn                                                              |
| DCF                        | FCFE vốn chủ, chiết khấu từng kỳ, Gordon terminal tại cuối kỳ cuối; growth < discount rate; không áp dụng FCFF/WACC                      |
| RSI / ATR                  | Wilder, seed SMA theo period thay đổi/TR; ATR bỏ bar đầu thiếu close trước; so với technicalindicators <0.01                             |
| MACD                       | EMA fast/slow seed SMA, signal EMA; cần slow+signal-1 giá; test tính tay và thư viện                                                     |
| Fibonacci                  | Retracement nhịp tăng, high - (high-low)*ratio; test đáp án thập phân bằng tolerance                                                     |
| NaN/Infinity/thiếu dữ liệu | Hàm toán trả reason không đủ dữ liệu; đã thêm guard candle/closing point null, series ngắn, chia 0 và tràn số                            |
| Đơn vị / EPS / price basis | Giá r/c/f/g3 nghìn VND→VND; closePrice không nhân thêm; EPS quý bị từ chối; giá chưa rõ basis hay trộn basis bị từ chối                  |
| Nguồn VPS                  | Endpoint và JSON do người dùng cung cấp, 30 mã/57 trường; không có endpoint lịch sử hay fundamentals được bịa                            |
| lot / lastVolume           | VPS_LOT_SIZE=10 chỉ cho lot; ACB 796910→7969100; evidence chỉ ACB 12/10/2026; lastVolume raw, test TODO theo yêu cầu                     |
| RLS / quyền                | ENABLE/FORCE RLS, USING + WITH CHECK, FK owner/watchlist ghép; test SET ROLE A/B, giả owner, đọc public, chặn private anon               |
| Secrets / injection        | Gitleaks source + mọi Git ref, redacted; không chứa key thật; service key chỉ scheduled handler; query SDK/RPC không ghép SQL từ request |
| Múi giờ / phiên            | Asia/Ho_Chi_Minh, lịch source + verified_at; guard thiếu lịch, ngày nghỉ, chưa đóng cửa; chưa có calendar production đã xác minh         |
| CI/CD / merge              | Workflow PR/main/merge_group, deploy needs verify; server ruleset phải bật ở GitHub; API đọc protection bị Forbidden                     |
| Migration                  | 2 SQL thực thi trên Postgres 17 với auth shim; chưa chứng minh hosted Supabase hay HTTP Auth/JWT end-to-end                              |
| Hello world                | Smoke khởi động web/worker thật, HTTP200 đúng nội dung; không chỉ kiểm tra PID/port                                                      |

## Lỗi tìm thấy và đã sửa

1. Khi chép fixture thiếu `mc`: khôi phục đúng giá trị `"10"` người dùng đưa cho
   toàn bộ 30 mã; test so tập trường bảo đảm đủ 57 trường. Không giảm validator
   hay bỏ assertion để cho test qua.
2. Test giả item vào watchlist B va vào primary key trước FK: dùng mã fixture
   thứ hai để kiểm tra đúng ràng buộc owner/watchlist, không chấp nhận unique
   violation thay cho việc chứng minh FK bảo vệ quyền.
3. SQL CHECK của score có thể nhận NULL như true: yêu cầu explicit reason
   không NULL khi value NULL, có test constraint từ chối score thiếu reason.
4. Wrangler không ghi được HOME trong cloud: wrapper đặt XDG config vào
   `.cache/xdg`, build và dev đã chạy thực tế.
5. Gitleaks generic rule đọc xuyên dòng key rỗng sang tên biến kế tiếp:
   tách comment giữa khai báo credential rỗng và cấu hình live. Không bỏ rule
   hay allowlist toàn bộ `.env.example`.
6. Gộp volume raw thành một unit có thể gây hiểu sai: phân biệt lot lô 10 và
   lastVolume chưa xác minh; giữ raw, tổng cổ phiếu riêng, chặn tràn số JS/DB.
7. Snapshot cũ có thể ghi đè mới: RPC chỉ update nếu fetched_at mới hơn.
   Database test kiểm tra trực tiếp giá cũ không ghi đè.
8. Cron danh mục rỗng có thể báo ok: từ chối ghi success khi không import mã nào,
   có test qua transport mock của SDK; chỉ cập nhật last_success_at sau RPC thành công.
9. Guard kỹ thuật có thể throw với candle/closing point null: sửa trả
   không đủ dữ liệu và thêm trường hợp null vào test.
10. State database dùng chung có thể đụng nhau giữa lần verify: tách file theo
    runId và kiểm tra label trước khi cleanup container.
11. Định dạng làm thay đổi AGENTS.md gốc: khôi phục nội dung gốc và loại khỏi
    Prettier. Next.js tự tạo web/AGENTS.md, đã đọc hướng dẫn/docs cùng phiên bản.
12. Markdown có dấu pipe trong mô tả làm vỡ bảng: sửa bảng thành đúng 4 cột;
    đã đối chiếu tập 57 tên trường trong tài liệu với fixture.

## Rủi ro còn lại và bước cần tài khoản bên ngoài

- Live VPS hiện FAIL do mạng/proxy; fixture tests không thay thế live. Domain
  được thêm vào bản nháp môi trường, cần áp dụng cấu hình rồi thử lại.
- Lot size mới đối chiếu 1 mã/1 ngày; chưa xác nhận HNX/UPCOM/đấu giá. lastVolume,
  volume sổ lệnh, bảng mã sàn, timestamp, price basis vẫn chưa có bằng chứng đầy đủ.
- Cache/rate limit thuộc mỗi isolate, cron nhiều batch không atomic toàn thị trường.
  Client phải đọc fetched_at/system_status, không xem timestamp lấy dữ liệu là timestamp sàn.
- Nguồn OHLCV/fundamentals/tin tức và lịch phiên chính thức chưa có; không seed
  fixture vào database thật hay biến snapshot thành lịch sử.
- Không có bằng chứng đã chạy Actions trên GitHub, bật branch ruleset, migrate
  Supabase hosted hoặc deploy Cloudflare. Các bước này cần quyền/tài khoản/secrets
  trong Settings. README có lệnh và hướng dẫn; không được báo toàn bộ cloud hoàn thành.

## Tự kiểm tra lại

Từ root repo: `npm ci`, `npm run tools:install`, `npm run verify`, `npm run smoke`.
`npm run verify:live` là kiểm tra riêng, không nằm trong CI. So raw log với summary,
đọc coverage JSON riêng strategies/scoring; phân biệt PASS, FAIL và 1 TODO lastVolume.
Xem README để migrate project do bạn sở hữu và bật required check `verify`.

## Khảo sát bổ sung 13/10/2026

Tình trạng nguồn ở báo cáo bên trên là thời điểm bàn giao Phần 1. Xem
[API research 13/10/2026](api-research-2026-10-13.md) và docs/data-sources.md
để biết endpoint KBS/Vietcap mới đã gọi thật và giới hạn chưa xác minh.
Đã sửa lệnh test để quote glob `tests/providers/**`: khi có hai file provider,
shell trước đây bung glob thành hai tham số và vô tình chỉ chạy test VPS, khiến
coverage tài chính về 0%. Không hạ threshold hay bỏ assertion; quote glob giúp
chạy lại đầy đủ 37 unit tests. Lệnh live dùng Node 24 --use-env-proxy, giữ TLS.
Live đối soát ghi REVIEW_NEEDED với SHS (volume lệch 5603); không đổi fixture
để hai nguồn khớp và không đưa dữ liệu còn thiếu basis vào ứng dụng.

## Sửa Cloudflare Workers Builds — 13/10/2026

Đã chạy `npm run verify` với 9/9 PASS trước lượt tự review này. Log đầy đủ,
nguyên văn của lần chạy đó được lưu tại
[verification-cloudflare-2026-10-13.txt](verification-cloudflare-2026-10-13.txt).
37 unit tests và 14 provider tests PASS, 1 TODO `lastVolume` theo yêu cầu;
coverage statements/functions/lines 100%, branches 97.75%.

Nguyên nhân trong log người dùng: build workspace thành công nhưng deploy mặc
định `npx wrangler deploy` ở root không tìm thấy config trong `worker/`, đi vào
auto-detection monorepo và lỗi. Tên config cũng khác tên Worker mà Workers Builds
truyền vào. Chuyển config duy nhất sang root, khai báo rõ entrypoint
`worker/src/index.ts` và tên `vn-stock-analyzer`. Wrapper cũng chạy từ root.

Tự review đã kiểm tra các tác động của việc chuyển config:

- Đường dẫn bundle vẫn là `worker/dist`; Pages dùng `web/out`, không còn
  `../web/out` sau khi đổi thư mục làm việc của wrapper.
- Secret local được đọc cạnh config mới tại root `.dev.vars`. `git check-ignore`
  xác nhận cả `.dev.vars`, `.dev.vars.production` và `worker/.dev.vars` bị ignore.
  Không sao chép secret vào source, không đổi quyền RLS hay public API.
- `CF_DEPLOYMENT_MODE=git-integration` bỏ qua CD Actions khi dùng hoàn toàn
  Cloudflare Git integration, giữ check `verify`. Mặc định CD Actions vẫn cần
  verify PASS trước deploy. Biến này chưa được đặt trong GitHub từ môi trường local.
- Không thay đổi công thức, đáp án test, schema, mapping nguồn dữ liệu hay lịch
  Cron. Checklist tài chính/bảo mật/múi giờ ở trên tiếp tục áp dụng; dữ liệu thiếu
  và lịch phiên chưa xác minh vẫn bị chặn như trước.

Kiểm tra bổ sung đã chạy thật:

- `npx --no-install wrangler deploy --dry-run --outdir worker/dist` từ root:
  exit 0, không còn lỗi monorepo. Đặt XDG cache trong repo để không ghi HOME.
- Cùng lệnh với `WRANGLER_CI_OVERRIDE_NAME=vn-stock-analyzer`: exit 0,
  không còn cảnh báo Worker name mismatch. Chỉ còn cảnh báo proxy của môi trường.
- `npm run smoke`: HTTP 200 đúng nội dung cho cả web và Worker; API input sai
  trả 400, thiếu Supabase trả 503. Không dùng secret production.

Chưa xác minh: deploy thật ở account Cloudflare, secret runtime và lần chạy
Actions sau push. Dry-run không chứng minh đã phát hành. Worker là API; giao diện
Next.js cần Pages riêng theo README. Nếu đã có Worker tên cũ
`vn-stock-analyzer-api`, phải cấu hình secrets cho Worker `vn-stock-analyzer`;
secret không tự chuyển giữa hai Worker khác tên.

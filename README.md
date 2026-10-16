# VN Stock Analyzer

Ứng dụng phân tích cổ phiếu Việt Nam (HOSE/HNX/UPCOM): Graham/Buffett, vùng giá, Top 10, watchlist, tin tức, cảnh báo backtest và đầu tư thử bằng vốn ảo. Next.js static export + TypeScript, Cloudflare Worker API/Cron, Supabase PostgreSQL/Auth/RLS. Có PWA Android/iPhone.

**Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.** Thiếu dữ liệu luôn được ghi rõ, không điền số giả hay coi thiếu dữ liệu là doanh nghiệp xấu.

- Production: <https://vn-stock-analyzer.manhhuong.workers.dev>
- Kiến trúc: [docs/architecture.md](docs/architecture.md).
- Dữ liệu và mức độ xác minh: [docs/data-sources.md](docs/data-sources.md), [khảo sát API](docs/api-research-2026-10-13.md).
- Hướng dẫn theo tính năng: [Top 10/Auth/watchlist](docs/phase4.md), [tin tức](docs/phase6.md), [cảnh báo/trạng thái](docs/phase7.md), [backtest/hiệu năng/bảo mật](docs/phase8.md), [PWA](docs/pwa.md).

## Giới hạn dữ liệu cần biết trước

Top 10 chỉ nhận mã đáp ứng chính sách `complete-v1`; không lấp đủ 10 bằng mã thiếu dữ liệu. Khi khảo sát Phần 8, project chưa có lịch sàn/giá phiên điều chỉnh được xác minh và chưa có Top 10 đủ chuẩn. Bar VPS/KBS hiện có là giá báo cáo chưa xác minh adjusted/unadjusted; không tự đưa vào scoring/backtest chính thức. Chưa có feed VN-Index được xác minh. `/backtest` lưu lịch sử từ khi triển khai, hiển thị độ phủ/thiếu dữ liệu và có công cụ đối chiếu giá báo cáo **tách riêng khỏi backtest Top 10**.

Kết quả backtest cần đủ thời gian quan sát và đầu vào có nguồn. Đọc [phương pháp và look-ahead/survivorship bias](docs/phase8.md) trước khi diễn giải lợi nhuận. Không cam kết giá thực thi hay hiệu quả đầu tư.

## Chạy và kiểm tra local

Cần Node.js 24 (`.nvmrc`), npm, Docker daemon, curl/tar/shasum; Linux/macOS/WSL2.

```bash
npm ci
npm run tools:install
npm run verify
npm run smoke
```

`verify` bắt buộc: strict typecheck, lint 0 warning, format, unit/coverage ≥80% ở các module quy định, build, Gitleaks, 19 migration PostgreSQL và RLS hai tài khoản, provider fixtures. Database test dùng container PostgreSQL 17 pin digest, không mở cổng và tự xóa; không cần production credential. Kiểm thử nguồn live/Google/email tách khỏi CI. Một fixture provider chưa triển khai được giữ TODO, không tính là PASS.

Tạo `.dev.vars` ở root từ tên biến trong `.env.example` (file ignored, không commit credential). Hai terminal:

```bash
npm run build --workspace web
npm run dev:worker
# Terminal khác:
NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8787 npm run dev:web
```

Hoặc phục vụ web đã build + Worker handler bằng Node proxy-aware ở port 8878:

```bash
npm run build
npm run dev:market
# --jobs chỉ dùng local để thử job quản trị, không công khai cổng này.
```

Browser mặc định lấy public URL/publishable key từ `/v1/public-config`; không cần secret lúc build. Các trang nghiệp vụ đều sau login gate; RLS bảo vệ dữ liệu cá nhân tại DB. Dữ liệu thị trường công khai qua API read-only.

## Triển khai từng bước

### 1. Supabase

Tạo project hoặc dùng project đã chọn trong `config/public-deployment.json`. Đặt `SUPABASE_PROJECT_REF` và `SUPABASE_ACCESS_TOKEN` qua môi trường quản trị, không đưa vào Worker/browser. Áp dụng migration theo thứ tự (script chỉ áp dụng file chưa ghi trong migration history):

```bash
# Chỉ áp dụng migration, không tải dữ liệu hay gửi email:
node --use-env-proxy --import tsx --input-type=module -e 'import {migrateHosted} from "./scripts/management.ts"; await migrateHosted();'
```

Với môi trường mạng bình thường có thể bỏ `--use-env-proxy`; giữ proxy/CA trong managed cloud. DDL phải lên trước code sử dụng schema mới. CI không tự migrate production.

Trong Authentication → URL Configuration đặt Site URL của website và allowlist callback `/auth/callback`, reset `/auth/reset-password` cho đúng production/local (xem script `configure-phase4-auth.ts`). `npm run configure:auth` bổ sung URL, giữ URL cũ.

Bật email provider; xác minh email/reset tùy SMTP của project. Với Google: tạo OAuth Web Client trong Google Cloud, thêm **Authorized redirect URI** `https://<project-ref>.supabase.co/auth/v1/callback`; nhập Client ID/Secret trong Supabase → Auth → Providers → Google. Đây là callback Supabase, không phải URL trang login. Không gửi secret vào chat/Git. Kiểm tra Google bằng trình duyệt thật; test user password không xác minh OAuth/email deliverability.

### 2. Cloudflare Worker

`wrangler.jsonc` là nguồn cấu hình: tên Worker, assets `web/out`, năm Cron, rate-limit bindings. Chọn đúng account trong biến `CLOUDFLARE_ACCOUNT_ID`; tài khoản gốc hiện tại là `9a0d6d0c169959b70222e98819280fe7` (namespace `manhhuong.workers.dev`). Không deploy sang account khác chỉ vì token nhìn thấy account đó.

Đặt qua Worker Settings → Variables and Secrets hoặc `node scripts/wrangler.mjs secret put NAME`:

- `SUPABASE_PUBLISHABLE_KEY`: publishable key `sb_publishable_*`; dùng cho RLS/public reads.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only, dùng Cron/jobs, không xuất qua public-config.
- `SUPABASE_URL`: URL project (mặc định public-deployment nếu bỏ trống).
- Các provider/RSS/LLM/email tùy bảng bên dưới. Không ghi plaintext var trùng tên secret đã có.

Cấu hình và sinh types khi đổi bindings:

```bash
node scripts/wrangler.mjs types --include-runtime=false --env-interface=WorkerBindings worker/src/bindings.d.ts
npm run verify
```

### 3. Chọn đúng một đường phát hành

**Repo hiện dùng Workers Builds kết nối GitHub main.** Trong Cloudflare Builds: root `/`, build command `npm run build`, deploy command `npx wrangler deploy`; chọn Build token còn hiệu lực **thuộc đúng account**. Thiết lập GitHub variable `CF_DEPLOYMENT_MODE=git-integration` để không deploy trùng từ Actions. Push main sau verify; kiểm tra cả GitHub CI và Cloudflare Builds, không coi push thành công là deploy thành công.

Nếu dùng CLI trong môi trường khác đã có token đúng quyền/account:

```bash
npm run verify
npm run deploy:worker
```

Không chạy song song CLI và Git integration. Pages/Actions cũ chỉ dùng nếu đã cấu hình rõ trong `.github/workflows/ci-cd.yml`; không tự tạo thêm website/account. Static assets và API hiện cùng Worker.

### 4. Đồng bộ dữ liệu thật và xác minh

```bash
npm run sync:market -- --migrate
npm run sync:financials
npm run sync:rankings
npm run verify:connections
npm run sync:system -- --production
```

Giới hạn nhóm mã bằng `SYNC_SYMBOLS`, xem `.env.example`. Không coi tải nguồn thành công là xác minh kỳ EPS, basis hay finality. Nhập lịch/sự kiện có nguồn qua `npm run import:evidence -- /path/calendar-events.json`; xem [phase4.md](docs/phase4.md). Không seed lịch bằng cách bỏ cuối tuần. Giá phiên điều chỉnh và VN-Index cần quy trình xác minh riêng tại [phase8.md](docs/phase8.md), chưa có nguồn tự động được chứng nhận.

Đăng nhập → `/top10`, `/watchlists`, `/alerts`, `/status`, `/backtest`, `/paper`, `/settings`. Trang status phân biệt mốc dữ liệu, lần sync thành công, nguồn lỗi và cấu hình còn thiếu. Đọc log cron thay vì suy từ thời gian mở trang.

### 5. Kiểm thử trên website thật

```bash
# Cần Chromium, chỉ cài khi chưa có:
npx playwright install chromium
MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:alerts:browser
MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:backtest:browser
```

Scripts dùng management credential trong RAM, tạo user thử/kiểm tra RLS rồi tự xóa, không in mật khẩu/key hay ghi giá thị trường giả vào production. Đặt `PLAYWRIGHT_BROWSERS_PATH` theo môi trường; scripts trong repo mặc định cache `/workspace/.cache/ms-playwright`. Live test không thay thế Google OAuth tương tác hoặc email thật.

## Biến môi trường và bindings

Không commit giá trị credential; `.env.example` chỉ có tên/mặc định công khai.

| Biến                                                               | Nơi dùng            | Ý nghĩa                                                                 |
| ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------- |
| `SUPABASE_URL`                                                     | Worker/local        | URL project; có mặc định công khai                                      |
| `SUPABASE_PUBLISHABLE_KEY`                                         | Worker/local        | Key công khai dùng RLS, bắt buộc có dữ liệu                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                        | Worker secret       | Quyền server ghi cache/jobs; cấm browser/log                            |
| `SUPABASE_PROJECT_REF`                                             | Script quản trị     | Project ref đúng đích                                                   |
| `SUPABASE_ACCESS_TOKEN`                                            | Môi trường quản trị | Migration/sync/live tests; không đặt NEXT_PUBLIC                        |
| `CLOUDFLARE_ACCOUNT_ID`                                            | CLI/CI              | Account chứa Worker                                                     |
| `CLOUDFLARE_API_TOKEN`                                             | CLI/CI secret       | Token đúng quyền và account; khác Build token đã chọn trong dashboard   |
| `NEXT_PUBLIC_WORKER_URL`                                           | Build web           | Ghi đè API base; public, thay đổi cần build lại                         |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Kiểm tra kết nối    | Public config tùy script; web Auth chính lấy public-config              |
| `CATALOG_PROVIDER`                                                 | Worker/script       | `kbs`                                                                   |
| `QUOTE_PROVIDER`                                                   | Worker/script       | `vps`                                                                   |
| `HISTORY_PROVIDER`                                                 | Worker/script       | `vps` hoặc `kbs`, không tự trộn nguồn                                   |
| `FUNDAMENTALS_PROVIDER`                                            | Worker/script       | `kbs`; VPS chưa có BCTC xác minh                                        |
| `SYNC_SYMBOLS`                                                     | Worker/script       | Danh sách tối đa 50 mã mỗi lượt đồng bộ                                 |
| `NEWS_RSS_PERMISSION`                                              | Worker              | `personal-nonprofit` theo xác nhận; thương mại cần rà quyền lại         |
| `NEWS_WEIGHT`                                                      | Worker              | 0–0,3; mặc định 0,1, thiếu LLM không có điểm tin giả                    |
| `NEWS_LLM_API_KEY`                                                 | Worker secret       | Key API tương thích OpenAI                                              |
| `NEWS_LLM_BASE_URL`                                                | Worker              | Base URL HTTPS, nối `/chat/completions`                                 |
| `NEWS_LLM_MODEL`                                                   | Worker              | Model thực do nhà cung cấp hỗ trợ                                       |
| `ALERT_EMAIL_API_KEY`                                              | Worker secret       | Resend, tùy chọn, hiện chưa cung cấp                                    |
| `ALERT_EMAIL_FROM`                                                 | Worker              | Địa chỉ/domain đã xác minh Resend, hiện còn thiếu                       |
| `VPS_LIVE_SYMBOLS`                                                 | Script/test         | Mã kiểm tra provider live, mặc định ACB                                 |
| `MARKET_APP_URL`                                                   | Browser test        | URL website cần kiểm tra                                                |
| `PLAYWRIGHT_BROWSERS_PATH`                                         | Browser test        | Thư mục Chromium                                                        |
| `npm_config_cache`                                                 | Local/cloud         | Cache npm ghi được khi HOME hạn chế                                     |
| `CF_DEPLOYMENT_MODE`                                               | GitHub variable     | `git-integration` cho cấu hình hiện tại; `actions` chỉ khi chọn Actions |
| `CF_PAGES_PROJECT`                                                 | GitHub variable cũ  | Chỉ dùng nhánh triển khai Pages được cấu hình riêng                     |

`ASSETS`, `API_RATE_LIMIT` (120/phút/IP), `ANALYSIS_RATE_LIMIT` (30/phút/IP) là **bindings trong wrangler**, không phải secret/environment string. Rate limit theo Cloudflare location, xấp xỉ; không phải quota toàn cầu và không giới hạn người dùng gọi Supabase REST trực tiếp. Public cache chỉ ở các API allowlist; dữ liệu cá nhân no-store/RLS. Không lưu service role trong `.env` public, source, issue hoặc README.

Cron UTC: `*/5 2-8 * * 1-5` kiểm tra giá trong phiên VN; `15 8 * * 1-5` chốt 15:15; `0 9 * * 1-5` phục hồi 16:00; `*/30 * * * *` RSS/xếp hạng; `*/5 * * * *` cảnh báo/email/VPS. Lịch cron không chứng nhận sàn mở; guard lịch có nguồn vẫn bắt buộc. Free plan có ngân sách CPU/subrequest; log lỗi/degraded và retention tại [phase7.md](docs/phase7.md), không hứa retry được hard termination ngay trong invocation.

## Thêm chiến lược hoặc nguồn mới

### Chiến lược

1. Xem interface và ví dụ tại `modules/strategies/`, `modules/scoring/engine.ts`, `modules/scoring/rankings.ts`. Giữ hàm thuần, dữ liệu/đơn vị/kỳ/ngày biết thông tin rõ ràng.
2. Thêm công thức và test có đáp án tính tay; thiếu/âm/chia 0 trả null/“không đủ dữ liệu”, không NaN/Infinity. Không sửa đáp án để khớp code.
3. Khai báo trọng số/độ phủ/lý do trong scoring, không tự phân phối lại trọng số dữ liệu thiếu. Thay mô hình phải tăng version và kiểm tra quality policy; cập nhật UI settings/giải thích.
4. Không ghi đè `ranking_publications` đã công bố hay dùng BCTC hiện tại chấm lại ngày cũ. Kiểm thử migration/RLS nếu đổi schema, chạy verify và kiểm tra đúng đơn vị VND/tỷ, EPS năm/quý, adjusted/unadjusted.

### Provider thị trường/BCTC

1. Thực thi `DataProvider` tại `modules/providers/data-provider.ts`; đăng ký trong `registry.ts`, cấu hình `ProviderConfig` và `.env.example`. Đọc schema/nguồn đã xác minh trong docs, không đoán endpoint.
2. Validate payload, OHLC, mã, timestamp, đơn vị; lưu provenance. Dùng `ProviderHttp` timeout/retry/rate limit/cache có giới hạn. Không tự chuyển nguồn âm thầm khi lỗi.
3. Giữ dữ liệu chưa xác minh riêng khỏi `prices_daily`/backtest chính thức. Thêm parser fixture + thử nguồn thật riêng, không coi fixture là xác minh nguồn live.
4. BCTC chống regression/mất field; không lấy backup chưa xác minh làm dữ liệu chấm điểm. Xem `financial-backup.ts` và các test tương ứng.

### RSS/LLM

Đăng ký nguồn ở `modules/news/sources.ts` và migration `news_sources`; kiểm tra robots/điều khoản/quyền đăng lại, không bypass nguồn bị chặn. Chỉ metadata/tóm tắt có link nguồn và bằng chứng theo [phase6.md](docs/phase6.md), không crawl toàn bài mặc định. Nhà cung cấp LLM đổi bằng ba biến `NEWS_LLM_*`, giữ schema/bằng chứng/không bịa số liệu; thêm fixture và test fail-closed. Không gửi API key đến origin tùy ý từ client.

## Bảo trì và chẩn đoán

- 400: kiểm tra mã/bộ lọc/ngày; 401: đăng nhập; 429: đợi Retry-After; 502/503: xem `/status`, migration và cấu hình nguồn.
- Google `redirect_uri_mismatch`: kiểm tra URI Supabase callback chính xác trong OAuth client tương ứng, không thay bằng đường dẫn login của app.
- Cloudflare Build token bị xóa/xoay: chọn token còn hiệu lực đúng account ở Worker → Settings → Builds; không chia sẻ token trong chat.
- Snapshot cũ ngoài giờ không đồng nghĩa API lỗi. Probe VPS chỉ xác nhận phản hồi một mã, không xác nhận toàn bộ thị trường/finality.
- Email thiếu khóa/domain: dùng thông báo trong app. Provider trả ID chỉ xác nhận chấp nhận, chưa chứng minh đã vào inbox.
- Định kỳ chạy Supabase Security Advisors. Các bảng service-only RLS không policy là chủ ý deny client; cảnh báo leaked password protection hiện chưa bật cần chủ project cân nhắc, không tự nâng gói.
- Rollback code qua Cloudflare deployment đã kiểm chứng; migration đã áp dụng giữ nguyên, sửa bằng migration mới. Không drop dữ liệu/lịch sử để làm status xanh.

## Đầu tư thử bằng vốn ảo

Đăng nhập → **Đầu tư thử** (`/paper`) → đặt tên ví, vốn ban đầu (100.000–1.000 tỷ VND) và tạo ví. Có thể tạo tối đa 20 ví để so sánh cách đầu tư; lịch sử ví cũ được giữ riêng. Từ trang chi tiết mã, chọn “Thử đầu tư” để điền sẵn mã.

Chọn mã, mua/bán, số lượng bội số 100 và lấy giá trước khi xác nhận. Mặc định lấy giá VPS; nếu nguồn không có giá hợp lệ, có thể chủ động chọn **giá đã lưu** và đánh dấu chấp nhận ngày giá được hiển thị (tối đa 14 ngày). Không tự chuyển sang giá cũ. Phiếu giá hết hạn sau 2 phút, chỉ dùng một lần. Giá danh mục được kiểm tra mỗi 10 giây khi trang đang mở, số dư/lịch sử kiểm tra mỗi 30 giây. Giá trị danh mục dùng giá đã quan sát gần nhất, có mốc thời gian; thiếu giá thì tổng tài sản/lãi lỗ ghi “không đủ dữ liệu”.

Phí giả định 0,15% mỗi chiều, thuế bán 0,1%, chỉnh được khi tạo ví (0–1%). Làm tròn phí/thuế lên 1 VND; vốn mua gồm phí; bán phân bổ giá vốn bình quân và ghi lãi/lỗ sau phí/thuế. Không margin, bán khống hay tiền thật. Khớp mô phỏng ngay, không mô phỏng T+2, trượt giá, thanh khoản thực, cổ tức hoặc điều chỉnh quyền; kết quả không thay thế backtest hay hiệu suất thực tế.

Không cần secret/binding mới. Migration `20261016033651_paper_investing.sql` tạo 4 bảng riêng tư, RLS chỉ đọc dữ liệu của chủ ví. Chỉ Worker xác thực người dùng mới gọi RPC tạo ví/giá/giao dịch bằng service key. API không nhận giá hoặc số dư từ trình duyệt; khóa hàng ví trong transaction và mã yêu cầu chống ghi trùng. Snapshot tiền/danh mục/lịch sử đọc nhất quán; lịch sử phân trang 20 dòng; API no-store và dùng rate limit đã có.

Kiểm tra: `npm run verify` gồm đáp án tính tay, RLS A/B và giao dịch đồng thời trong PostgreSQL tạm. Kiểm tra UI + Auth + ví thử trên môi trường đã áp dụng migration: `npm run verify:paper:browser` (mặc định local; đặt `MARKET_APP_URL` để thử deployment). Script tạo rồi xóa hai tài khoản thử, chỉ tạo vốn/giao dịch ảo, không ghi giá giả vào bảng dữ liệu thị trường.

# vn-stock-analyzer

Phần 1–2: tra cứu cổ phiếu và biểu đồ giá thật với Next.js + TypeScript strict + Tailwind, Workers API/Cron,
Supabase PostgreSQL/Auth/RLS và GitHub Actions. Chỉ hỗ trợ thị trường Việt Nam
(HOSE/HNX/UPCOM). Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.

Kiến trúc và sơ đồ Mermaid: [docs/architecture.md](docs/architecture.md).
Khảo sát nguồn bổ sung và endpoint đã gọi thật: [API research 13/10/2026](docs/api-research-2026-10-13.md).
Nguồn VPS, tất cả 57 trường và mức độ xác minh:
[docs/data-sources.md](docs/data-sources.md).

## Chạy local

Cần Node.js 24 (`.nvmrc`), npm, Docker daemon đang hoạt động, curl/tar/shasum.
Linux/macOS hoặc WSL2; script database không mở port và chỉ dùng database kiểm thử
dùng một lần. Không cần Supabase/Cloudflare credential để chạy hello world/verify.

```bash
cd vn-stock-analyzer
npm ci
npm run tools:install
npm run verify
npm run smoke
```

Nếu HOME không ghi được trong cloud, dùng
`export npm_config_cache=/workspace/.npm-cache` trước khi chạy npm. Wrapper Wrangler
tự đặt XDG config vào `.cache/xdg`; không tắt TLS/checksum verification.
`tools:install` tải Gitleaks 8.30.0 từ release chính thức và kiểm tra SHA256.
Docker image PostgreSQL 17 được pin digest trong `scripts/database.mjs`.

Mở hai terminal từ thư mục gốc để phát triển:

```bash
npm run build --workspace web
NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8787 npm run dev:web
# Terminal khác; cấu hình Supabase trong ignored .dev.vars ở root để có dữ liệu thật.
npm run dev:worker
```

Web ở port 3000; Worker ở port 8787. `/health` trả hello world tiếng Việt.
`GET /v1/quotes?symbols=ACB,BID` đọc snapshot Supabase, trả 503 khi chưa cấu hình
nguồn và 400 khi mã sai. CORS public chỉ dành cho dữ liệu thị trường đọc công khai.
Không có endpoint HTTP cho service_role hay thao tác private ở Phần 1.
`npm run smoke` tự khởi động/dừng hai dịch vụ ở port 3100/8788 và kiểm tra nội dung
HTTP thật. Nó yêu cầu port trống và không dừng dịch vụ đã có của người dùng.

### Project Supabase và Worker đã chọn

URL mặc định được lưu trong `config/public-deployment.json`:

- Supabase: `https://aszceahzutkhqfpyclev.supabase.co`.
- Workers API: `https://vn-stock-analyzer.manhhuong.workers.dev`.

Đây là URL công khai, không phải credential. `SUPABASE_URL` ở Worker có thể ghi đè
URL mặc định. Publishable key vẫn lấy từ biến `SUPABASE_PUBLISHABLE_KEY` đã đặt
trong Cloudflare; không ghi key thật vào source hay `.env.example`.
Không khai báo thêm Wrangler plaintext var trùng tên secret đã có trong dashboard.

Trang chủ có tìm kiếm mã/tên công ty và lọc HOSE/HNX/UPCOM. Trang chi tiết
`/stocks?symbol=VNM` hiển thị quote thật, phần trăm thay đổi có dấu, biểu đồ nến
ngày/tuần/tháng, MA20/50/200 và volume. MA chỉ xuất hiện khi đủ nến; tính trước khi
zoom khoảng ngày. Có chế độ sáng/tối, thời điểm nhận dữ liệu và cảnh báo nguồn lỗi.
Không truy vấn watchlist/cảnh báo/cài đặt cá nhân trong phần này.

`GET /v1/public-config` trả URL Supabase và publishable key từ Worker, có CORS và
`Cache-Control: no-store`. Chỉ chấp nhận key `sb_publishable_*`; service_role,
`sb_secret_*` hoặc key thiếu trả 503, không xuất key. Publishable key được thiết kế
để công khai cho browser; bảo vệ dữ liệu riêng vẫn bằng RLS. Nếu trước đây Worker
dùng legacy anon JWT, thay biến publishable bằng publishable key mới trong dashboard.
Secret service_role chỉ dành cho Cron, không có trong endpoint này.

Pages không cần copy key vào biến build: browser lấy public config lúc kiểm tra.
Có thể ghi đè bằng `NEXT_PUBLIC_WORKER_URL`, hoặc cặp `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` trong build environment. Biến Next public
được đóng vào bundle lúc build, đổi biến cần build lại; tuyệt đối không đặt service
role/secret key vào `NEXT_PUBLIC_*`.

`npm run verify:connections` gọi thật Supabase/Worker, là lệnh read-only ngoài CI.
Để kiểm tra project trực tiếp trước khi endpoint public-config được deploy, đặt
các biến public vào file local ignored `.cache/connection.env` (hoặc export biến
tương ứng); lệnh không in key hay raw payload. Exit 1 khi kết nối/schema lỗi,
không coi lỗi live là PASS chỉ vì unit tests xanh.

## Dữ liệu Phần 2 và đồng bộ

Endpoint đã gọi thật, đơn vị và các giới hạn: [docs/data-sources.md](docs/data-sources.md).
VPS catalog lỗi 503 trong khảo sát; dùng danh mục KBS đã xác minh thay vì đoán schema.
Cấu hình mặc định: `CATALOG_PROVIDER=kbs`, `QUOTE_PROVIDER=vps`, `HISTORY_PROVIDER=vps`.
Có thể đổi history sang `kbs`; nguồn được lưu cùng từng bar, không trộn chuỗi.
Các tổ hợp không hỗ trợ báo lỗi rõ, không tự chuyển nguồn ngầm.

`GET /v1/stocks?q=viet%20nam&exchange=HOSE` tìm mã/tên, bỏ dấu tiếng Việt,
giới hạn 20 gợi ý. `GET /v1/stocks/VNM` trả công ty, quote, history, provenance và
notices. Mã phải tồn tại trong danh mục Việt Nam trước khi gọi provider.
Cache quotes 15 giây, history 15 phút, profile/catalog 24 giờ trong isolate;
rate limit 1 request/giây, batch tối đa 50, timeout 25 giây, retry tối đa 2 lần
cho network/429/5xx. Cache không phải giới hạn toàn cục giữa mọi isolate.

Để áp dụng migration và đồng bộ **project của bạn**, cấp `SUPABASE_ACCESS_TOKEN`
qua Environment Secrets và `SUPABASE_PROJECT_REF` đúng project. Script chỉ ghi
bảng thị trường, không seed fixture; lần chạy sau kiểm tra migration đã áp dụng.

```bash
npm run sync:market -- --migrate
# Sau khi migration đã áp dụng:
SYNC_SYMBOLS=VNM,FPT,HPG npm run sync:market
```

Mặc định đồng bộ toàn bộ catalog và 3 năm history/quote cho VNM/FPT/HPG.
`SYNC_SYMBOLS` chọn tối đa 50 mã mỗi lượt. Các mã khác tải history khi mở trang;
Worker ghi cache Supabase khi có service_role, bằng RPC kiểm tra quyền và chống
snapshot cũ ghi đè. Cron `0 9 * * 1-5` (16:00 Việt Nam) cập nhật catalog và nhóm
mã cấu hình khi lịch phiên xác nhận mở và đã qua `closes_at`; thiếu lịch/ngày nghỉ
thì bỏ tải. Lỗi từng nguồn được ghi degraded và giữ dữ liệu cũ.
Cron này chỉ lưu dữ liệu nguồn, không tạo ngày giao dịch hay đánh dấu phiên đóng.
`prices_history` giữ `price_basis=unverified`; chưa đưa vào scoring hoặc
`prices_daily` vốn yêu cầu cơ sở giá/lịch phiên đã xác minh. Mọi bar nguồn hiện tại
đều chưa xác minh finality, kể cả ngày đã qua.

Ngày 13/10/2026 đã chạy migration thật trên project Supabase được cung cấp:
1.522 mã (HOSE 406, HNX 299, UPCOM 817); 746 bar/mã VNM, FPT, HPG;
2.238 bar và 3 snapshot ban đầu. Đây là số liệu lúc đồng bộ, có thể thay đổi.

Kiểm tra giao diện local với **nguồn thật**, không mock API:

```bash
npm run build
# Điền public URL/key vào .cache/connection.env (ignored); không dùng service_role.
npm run dev:market
# Terminal khác, dùng cache browser ghi được:
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npx playwright install chromium
npm run verify:browser:live
```

Adapter Node phục vụ web đã build và cùng Worker handler tại port 8878, hỗ trợ
proxy mạng của cloud. Browser test kiểm tra VNM/FPT/HPG, Enter, chart canvas,
ngày/tuần/tháng, mobile 390px, theme giữ sau reload và lỗi JavaScript.
Có thể đặt `MARKET_APP_URL` để kiểm tra site đã triển khai. Kiểm tra live tách khỏi
CI để sự cố nguồn ngoài không làm test fixture thiếu tính tái lập.

## Lệnh verify bắt buộc

`npm run verify` chạy **tuần tự**, dừng khi bước đầu tiên thất bại, trả exit code
khác 0 và in bảng PASS/FAIL/NOT RUN. Không biến bước chưa chạy thành PASS.

| Thứ tự | Lệnh / ý nghĩa                                                              |
| ------ | --------------------------------------------------------------------------- |
| 1      | `npm run typecheck`: `tsc --noEmit`, strict + unchecked index               |
| 2      | `npm run lint`: ESLint, `--max-warnings 0`                                  |
| 3      | `npm run format:check`: Prettier check                                      |
| 4      | `npm run test`: Vitest unit + coverage V8                                   |
| 5      | `npm run build`: Next static export và Wrangler dry-run bundle              |
| 6      | `npm run verify:secrets`: Gitleaks source + lịch sử Git, redacted           |
| 7      | `npm run verify:migrations`: toàn bộ SQL trên Postgres container mới        |
| 8      | `npm run verify:rls`: A/B isolation, update/delete/insert giả owner, FK cha |
| 9      | `npm run test:provider`: parser fixture VPS thật, đối chiếu ACB             |

Coverage yêu cầu **>=80% statements, branches, functions, lines**, áp dụng riêng
cho `modules/strategies/` và `modules/scoring/`. Báo cáo ở `coverage/` (text,
lcov, json-summary); log và summary lần chạy mới nhất ở `.cache/verify.log` và
`.cache/verify-summary.json`. Công thức có đáp án tính tay trong comment; RSI,
MACD, ATR đối chiếu `technicalindicators` với sai lệch <0.01. Test riêng cho đơn vị,
EPS quý/năm và price basis. Các hàm này chưa được nối với dữ liệu thật chưa xác minh.

Database kiểm thử có shim `auth.users`/`auth.uid()` và role anon/authenticated/
service_role để thực thi RLS thực sự trong PostgreSQL. Test SET ROLE authenticated
và claims hai UUID khác nhau, không chỉ SELECT bằng postgres superuser. Đây
**không phải** kiểm thử Supabase Auth/HTTP/JWT end-to-end hay Supabase hosted.
Container chỉ có network `none`, không publish port, không lưu credential production.
Verifier xóa container do chính nó tạo. Chạy `verify:migrations` riêng rồi
`verify:rls` nếu cần chẩn đoán; lệnh sau xóa database kiểm thử.

`npm run verify:live` gọi endpoint thật với `VPS_LIVE_SYMBOLS=ACB` mặc định. Nó tách
riêng khỏi verify/CI, thất bại khi bị chặn mạng hoặc schema khác fixture. Endpoint
hiện tại không cần credential theo nguồn người dùng xác nhận; không bịa API key.
Provider dùng `VPS_LOT_SIZE=10` (config có version trong repo) chỉ cho `lot`;
ACB 796910 → 7.969.100 cổ phiếu, đã xác minh 1 mã/ngày, cần đối chiếu thêm.
`lastVolume` giữ nguyên, có test pending, không dùng scoring/rankings.
Có `npm run verify:sources` đọc-only đối chiếu bar KBS/Vietcap trên 4 mã/1 phiên.
Lệnh dùng proxy môi trường Node 24, chạy riêng ngoài CI, không ghi Supabase hay
tự đổi provider; exit 2 khi có khác biệt (SHS volume), exit 1 khi mạng/schema lỗi.
Ví dụ đổi phiên/mã: `SOURCE_PROBE_DATE=2026-10-12 SOURCE_PROBE_SYMBOLS=ACB npm run verify:sources`.
Nguồn BCTC mới có payload thật, mapping/đơn vị chưa xác minh; chưa ingest/scoring.

## Supabase

1. Tạo project Supabase qua dashboard, ghi nhận project ref, URL, publishable key.
   Chỉ browser/publishable key được công khai; service_role key là secret của Worker.
2. CLI dùng phiên bản `2.120.0` (pin trong các lệnh dưới). Đăng nhập và liên kết
   project do bạn sở hữu; xem trước migration trước khi ghi database cloud.

```bash
npx supabase@2.120.0 login
npx supabase@2.120.0 link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase@2.120.0 db push --dry-run
npx supabase@2.120.0 db push
```

Migrations trong `supabase/migrations/`. Không chạy `tests/database/bootstrap.sql`
hay fixture RLS trên project thật. Các table thị trường cho anon đọc công khai;
private tables dùng Auth UUID/owner_id, USING + WITH CHECK và FK ghép. Không dùng
service_role trong browser. Các bước hosted cần quyền project; verify PostgreSQL container không thay thế
kiểm tra hosted. Lệnh Management API ở trên đã áp dụng cả ba migration vào project
được cung cấp ngày 13/10/2026.

Có thể dùng Supabase local đầy đủ với Docker để kiểm tra Auth/PostgREST ở bước sau:

```bash
npx supabase@2.120.0 start
npx supabase@2.120.0 db reset --local
```

`db reset --local` xóa dữ liệu **local**; không dùng `--linked` cho kiểm thử. Thiết lập
Auth Site URL và redirect allowlist đúng domain Pages; local là localhost:3000.
Chưa có đăng nhập/redirect UI trong Phần 1. Danh mục được đồng bộ từ KBS đã xác minh. Lịch phiên vẫn cần nguồn được xác nhận;
không dùng fixture để seed production. Cron snapshot Phần 1 bỏ tải khi thiếu lịch.

## Cloudflare Pages / Workers và secrets

1. Tạo API token Workers Scripts Edit cho **account chứa `manhhuong.workers.dev`**.
   Chọn đúng Account ID; không đưa token vào repo hay log.
2. Giao diện được phục vụ bằng Workers Static Assets ngay trên URL Worker cũ.
   Pages là tùy chọn; chỉ cần thêm Pages Edit nếu triển khai Pages riêng.

```bash
npm run build
node scripts/wrangler.mjs deploy
```

Tên Worker mặc định `vn-stock-analyzer`, Cron trong `wrangler.jsonc` ở gốc repo.
Đây là cấu hình duy nhất cho CLI, workspace `worker/` và GitHub Actions; entrypoint
`worker/src/index.ts` là API Worker. `npm run deploy:worker` chạy deploy từ root
và đặt thư mục cache Wrangler cho môi trường hạn chế quyền ghi HOME.
Tài khoản Cloudflare và quyền network cần sẵn có để các lệnh ghi này chạy. CI
build/dry-run không tạo resource hay publish.

### Nếu kết nối GitHub bằng Cloudflare Workers Builds

Trong Workers & Pages → Worker `vn-stock-analyzer` → Settings → Build, cấu hình:

| Thiết lập         | Giá trị                             |
| ----------------- | ----------------------------------- |
| Root directory    | Gốc repository (để trống hoặc `/`)  |
| Production branch | `main`                              |
| Build command     | `npm run build`                     |
| Deploy command    | `npx wrangler deploy`               |
| Node.js version   | `24` (biến build `NODE_VERSION=24`) |

Lệnh deploy mặc định tìm `wrangler.jsonc` tại root, thay vì tự phát hiện ứng dụng
ở gốc monorepo. Build biên dịch cả web và worker; deploy phát hành
API/Cron và static assets `web/out` trên cùng URL Worker. Kiểm tra trước từ root: `node scripts/wrangler.mjs deploy --dry-run`.
Sau deploy, URL Worker `/health` trả hello world; `/v1/quotes` cần các secret Supabase
bên dưới. Thông báo dry-run `No bindings found` không phải lỗi, vì repo không ghi
giá trị secret vào config.

Giao diện Next.js xuất ra `web/out`, được gắn bằng `assets` trong Wrangler.
Không cần Pages riêng để xem trang chủ ở URL Worker. `/v1/*` và `/health` chạy
Worker trước; các trang/JS/CSS dùng static assets. Nếu cần Pages riêng, có thể
Direct Upload `web/out` hoặc Git integration build `npm run build --workspace web`,
output `web/out`, `NODE_VERSION=24`.

Chọn một pipeline CD: Workers Builds **hoặc** GitHub Actions. Khi dùng Workers
Builds, đặt repository variable `CF_DEPLOYMENT_MODE=git-integration` để tránh
job Actions deploy trùng; job verify vẫn chạy. Khi dùng Actions, đặt
`CF_DEPLOYMENT_MODE=actions`; `CF_PAGES_PROJECT` chỉ cần nếu muốn deploy Pages thêm.
Chưa bật mode Actions hoặc Pages project thì deploy job SKIPPED, không phải đã publish.

Nếu đã lưu biến local vào `worker/.dev.vars`, chuyển file sang `.dev.vars` ở gốc
repo: Wrangler đọc biến cạnh config. Cả hai vị trí và các biến thể `.dev.vars.*`
đều bị Git ignore; không commit file này.

### Secrets của Worker

Tạo Worker secrets qua CLI/dashboard, nhập giá trị an toàn khi CLI hỏi:

```bash
node scripts/wrangler.mjs secret put SUPABASE_URL
node scripts/wrangler.mjs secret put SUPABASE_PUBLISHABLE_KEY
node scripts/wrangler.mjs secret put SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` chỉ dùng trong Worker ghi market data qua Cron hoặc
background cache; không trả về browser hay nhận service key từ request client.
Phần đọc public dùng publishable key. Secret runtime đã đặt được giữ khi deploy;
workflow không in hay tự suy ra giá trị. Local đặt các tên Worker vào
`.dev.vars` ở gốc repo (ignored). `.env.example` liệt kê tên, không chứa giá trị secret;
web nếu cần dùng biến public thì tạo `web/.env.local` (ignored). Không copy nguyên
secret Worker sang biến `NEXT_PUBLIC_*`.

## GitHub Actions, CD và chặn merge đỏ

Workflow `.github/workflows/ci-cd.yml` chạy mọi pull request và push main:
`npm ci` → cài Gitleaks → `npm run verify` → smoke. Artifact giữ log/coverage và
static web đã build. Job deploy **needs verify**, chỉ push `main` khi đã cấu hình
mode `actions` (hoặc Pages project) và không chọn mode `git-integration`,
triển khai Worker cùng giao diện từ artifact đó; Pages chỉ deploy khi có project. PR không nhận deployment secrets và không deploy.
API VPS live không chạy trong CI. CD chưa tự áp dụng migration cloud; dùng db push
được review trước khi deploy phiên bản cần schema mới.

Trong Settings → Secrets and variables → Actions, đặt:

| Loại     | Tên                   | Dùng cho                                                |
| -------- | --------------------- | ------------------------------------------------------- |
| Secret   | CLOUDFLARE_API_TOKEN  | Deploy Worker/Pages                                     |
| Secret   | CLOUDFLARE_ACCOUNT_ID | Chọn account                                            |
| Variable | CF_PAGES_PROJECT      | Pages project Direct Upload đã tạo                      |
| Variable | CF_DEPLOYMENT_MODE    | `actions` bật CD; `git-integration` dùng Workers Builds |

Bật Actions, thiết lập environment `production` chỉ cho nhánh `main`. Không cần
Supabase service key trong GitHub Actions vì migration CI dùng container và key
runtime nằm ở Cloudflare. Job deploy SKIPPED khi chưa bật mode Actions/Pages hoặc đã chọn
Git integration; khi đã bật CD Actions, job sẽ lỗi rõ nếu thiếu
token/account. Không coi job deploy SKIPPED là bằng chứng đã phát hành lên Cloudflare.

**Workflow không tự chặn merge.** Trong Settings → Rules → Rulesets tạo branch
ruleset cho `main`: require pull request, require status checks, chọn check
**`verify`** sau lần CI đầu tiên, require branch up-to-date, áp dụng cả admin và
không cấu hình bypass nếu muốn mọi merge bị chặn khi đỏ. Đặc tính này cần quyền
quản trị repository và gói GitHub hỗ trợ rulesets cho repo của bạn. Chưa có bằng
chứng ruleset đã được bật chỉ vì file workflow tồn tại. Nếu dùng merge queue,
workflow cũng xử lý `merge_group` để check không bị chờ vô hạn.

`npm ci` cài Husky. Pre-commit gọi lint-staged với `--hide-all` (ẩn cả untracked) và chạy full
`npm run verify` trên nội dung staged (kể cả partial staging), kiểm tra định dạng
trước. Hook không tự sửa đáp án, format hay source. Hooks có thể bị bỏ qua bằng
Git client/HUSKY=0; ruleset + CI là lớp bắt buộc ở server.

## Cấu trúc

```text
web/                  Next.js app + ui, static export
worker/               Workers API, news scaffold, bundle dist/
wrangler.jsonc        Cấu hình Worker/Cron dùng chung, CLI deploy từ root
modules/providers/    DataProvider, VpsProvider, wire types/validation
modules/strategies/   Công thức + kiểm tra đầu vào, chưa có chiến lược production
modules/scoring/      Biên an toàn; chưa tạo score model
modules/market/       Ngày Việt Nam và guard lịch phiên
supabase/migrations/  Schema, index, RLS, RPC snapshot hiện tại
fixtures/             Phản hồi thật VPS do người dùng cung cấp
tests/                Unit, fixture parser, database/RLS
scripts/              Verify tuần tự, smoke, database, Gitleaks, Wrangler wrapper
.github/workflows/    CI mọi PR, CD sau verify trên main
docs/                 Kiến trúc, nguồn dữ liệu và kết quả review
```

Giới hạn hiện tại: chưa xác minh cơ sở điều chỉnh lịch sử giá, tài liệu quota và
quyền phân phối; chưa có mapping BCTC cho production hay lịch nghỉ lễ có nguồn.
`lot × 10` mới đối chiếu ACB một ngày; `lastVolume` và timestamp sàn chưa rõ.
Chưa có ranking/scoring/tin tức/đăng nhập/watchlist UI trong Phần 2.
Không mô tả deploy, CI hosted hay kiểm thử Auth JWT thành công nếu chưa chạy thật.

## Phần 3: engine chấm điểm

Trang chi tiết `/stocks?symbol=VNM` có điểm Graham/Buffett, từng tiêu chí, định giá,
biên an toàn, mức tin cậy/rủi ro và bảng BCTC năm. `/settings` chỉnh trọng số và giả
định DCF; từ bản giao diện đăng nhập mới, các trang tính năng đều yêu cầu đăng nhập.
Cài đặt được lưu theo tài khoản Supabase và áp dụng trên trình duyệt. Đăng ký tại
`/login` và xác nhận email. Không đặt mật khẩu
hoặc service-role key vào frontend.

```bash
npm run verify
npm run verify:financials:live       # live, read-only, không chạy CI
npm run sync:financials -- --migrate # Management token qua Environment Secrets
npm run verify:scoring:browser      # app local/production qua MARKET_APP_URL
```

`FUNDAMENTALS_PROVIDER=kbs`, bổ sung Vietcap ROIC/số CP; VPS chưa có BCTC đã xác nhận.
Lưu bảng `fundamentals`, `financial_snapshots`, điểm mặc định `scores`, preferences có
RLS. Cron16:00 Việt Nam sau sync thị trường đồng bộ BCTC nhóm SYNC_SYMBOLS.
Xem [nguồn/đơn vị](docs/data-sources.md) và [định nghĩa engine](docs/scoring-engine.md).
Chỉ dùng BCTC năm hợp nhất đã kiểm toán theo metadata, 3 năm để sàng lọc rút gọn;
DCF proxy CFO−Capex chỉ là kịch bản riêng, không dùng chấm điểm. DCF công ty mẹ
và biên an toàn Buffett trả “không đủ dữ liệu” đến khi xác minh dòng tiền mẹ.
Nguồn chưa đối chiếu PDF gốc: confidence bị giới hạn, kết luận giữ Quan sát.

## Phần 4: Top 10, Auth, Watchlist

`/top10` hiển thị ba horizon với lọc sàn/ngành/vốn hóa, mức bao phủ dữ liệu và nút
thêm vào danh sách. `/login` có email/password, đăng ký/reset và Google PKCE;
`/login` có bố cục hai cột với minh họa chứng khoán, mobile một cột, không hiện menu tính năng.
Toàn bộ trang tra cứu, chi tiết, Top 10, theo dõi và cài đặt chỉ hiển thị sau đăng nhập;
truy cập trực tiếp được chuyển về login rồi quay lại đúng trang/mã.
`/watchlists` bảo vệ bằng getUser + RLS, nhiều danh sách, ghi chú/giá mục tiêu và
điểm so với ngày xếp hạng trước. [Hành vi, trọng số, nguồn và các điều kiện còn thiếu](docs/phase4.md).

```bash
npm run verify
npm run configure:auth
npm run sync:rankings -- --migrate --refresh --metadata
npm run verify:phase4:live -- --browser
npm run verify:login:browser # route guard, login/logout thật, desktop/mobile
```

Các browser verifier đăng nhập bằng tài khoản xác nhận tạm, cần `SUPABASE_PROJECT_REF`
và `SUPABASE_ACCESS_TOKEN` trong môi trường quản trị; tự xóa user/dữ liệu riêng trong
`finally`, không ghi mật khẩu ra file/log. Không dùng account người dùng để kiểm thử.
`MARKET_APP_URL` mặc định localhost:8878. SMTP và luồng chấp thuận Google kiểm tra riêng.

Top 10 chỉ xếp hạng khi có đủ đầu vào và bằng chứng giá; các mã thiếu dữ liệu
được hiển thị riêng, không có thứ hạng. Bảng có thể rỗng khi nguồn chưa đáp ứng.
DPR đã bổ sung cổ tức/CFO/Capex công ty mẹ từ PDF kiểm toán, kèm trang và hash;
DCF Buffett vẫn giữ thiếu dữ liệu nếu chưa có Owner Earnings. Xem
[kiểm tra chất lượng DPR](docs/data-quality-dpr.md). Chạy
`npm run verify:ranking-quality:live -- --browser` để kiểm tra sau sync/deploy.

Google provider chưa được cấu hình. Lịch phiên/price basis chưa có nguồn xác minh:
Cron intraday/EOD được bảo vệ và chưa tự chạy; điểm kỹ thuật/volume thiếu được ghi
rõ, không chấm history unverified. Giá tham chiếu KBS lưu riêng và có nhãn, không
đóng giả giá giao dịch VPS. Có `import:evidence` để nhập lịch/sự kiện có nguồn sau
khi xác minh; không suy ngày nghỉ/KQKD hay đưa fixture vào production.

### Phần 5: vùng giá và quản lý rủi ro

Trang chi tiết mã có vùng mua, TP1–TP3 đủ R:R ≥2, SL theo ATR/đáy/% và trailing stop; mỗi mức có lý do, bước giá và trạng thái so với biên độ phiên. Cảnh báo định giá/RSI/MACD/thanh khoản và giới hạn dữ liệu hiển thị ngay bên dưới. Cài đặt riêng mã/tài khoản lưu trên trình duyệt. Xem [phương pháp và kiểm thử Phần 5](docs/phase5.md); lịch sử chưa xác minh basis nên các vùng hiện là kịch bản tham khảo.

### Phần 6: tin tức và yếu tố ảnh hưởng

RSS bốn nguồn, Cron 30 phút, gắn mã/ngành/vĩ mô và loại trùng; trang chi tiết có tin, nguồn và bảng yếu tố ảnh hưởng. LLM tương thích OpenAI dùng secrets, tóm tắt trích xuất có bằng chứng; chưa cấu hình thì ghi không đủ dữ liệu. Top10 dùng trọng số tin mặc định10%, chỉnh0–30%, giữ nguyên bộ lọc dữ liệu đầy đủ. Xem [phương pháp, điều kiện nguồn và cấu hình Phần6](docs/phase6.md).

## Phần 7: Cảnh báo và trạng thái

Sau đăng nhập, mở `/alerts` để đặt cảnh báo cho mã trong watchlist và thử nhận thông báo trong app; `/status` hiển thị mốc dữ liệu thật, nhật ký cron và phép thử VPS. Cron cảnh báo riêng chạy mỗi 5 phút. Email Resend là tùy chọn, cần khóa và địa chỉ gửi thuộc domain đã xác minh. Xem [hướng dẫn Phần 7](docs/phase7.md) về điều kiện, RLS, retry và cấu hình còn thiếu.

## Ứng dụng điện thoại (PWA)

Mở [Cài VN Stock](https://vn-stock-analyzer.manhhuong.workers.dev/install) trên điện thoại.
Android dùng Chrome → Cài đặt ứng dụng; iPhone dùng Safari → Chia sẻ → Thêm vào
Màn hình chính. Dùng chung tài khoản/dữ liệu với website, có điều hướng dưới và
trang báo mất mạng; cần mạng để cập nhật giá và dữ liệu cá nhân.
Xem [hướng dẫn và chính sách offline](docs/pwa.md).

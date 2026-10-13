# vn-stock-analyzer

Bộ khung Phần 1: Next.js + TypeScript strict + Tailwind, Workers API/Cron,
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
npm run dev:web
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

Trang chủ có nút **Kiểm tra kết nối**. Nó kiểm tra health Worker, khả năng đọc ba
bảng thị trường công khai ở Supabase và đọc snapshot ACB qua Worker. Health xanh
không biến lỗi database thành PASS; bảng rỗng không được mô tả là đã có giá.
Không truy vấn watchlist/cảnh báo/cài đặt cá nhân và không ghi dữ liệu.

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

Kết quả live ngày 13/10/2026 trước thay đổi này: Supabase nhận publishable key nhưng
Data API trả `PGRST205` cho `stocks`, `prices_current`, `trading_sessions`;
Worker health HTTP 200, quotes HTTP 502. Cần áp dụng migration bằng CLI ở phần
Supabase bên dưới hoặc kiểm tra bảng đã được expose/schema cache. Không seed fixture
vào database production. Môi trường Codex chưa có quyền quản trị hai dịch vụ;
việc kết nối chúng trong dashboard của bạn không tự cấp credential cho Codex.

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
service_role trong browser. Các bước hosted này cần tài khoản project và chưa được
thực thi khi chỉ chạy verify PostgreSQL container.

Có thể dùng Supabase local đầy đủ với Docker để kiểm tra Auth/PostgREST ở bước sau:

```bash
npx supabase@2.120.0 start
npx supabase@2.120.0 db reset --local
```

`db reset --local` xóa dữ liệu **local**; không dùng `--linked` cho kiểm thử. Thiết lập
Auth Site URL và redirect allowlist đúng domain Pages; local là localhost:3000.
Chưa có đăng nhập/redirect UI trong Phần 1. Nhập danh mục mã/sàn và lịch phiên từ
nguồn đã xác nhận; không dùng fixture VPS để seed production. Thiếu lịch Cron bỏ tải.

## Cloudflare Pages / Workers và secrets

1. Tạo API token scope tối thiểu cho account: Workers Scripts Edit và Cloudflare
   Pages Edit. Chọn Account ID. Không đưa token vào repo hay log.
2. Tạo Pages project dạng **Direct Upload**, production branch `main`. CI build
   artifact `web/out`; không bật thêm Git integration deploy trùng workflow.

```bash
node scripts/wrangler.mjs pages project create "$CF_PAGES_PROJECT" --production-branch main
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
ở gốc monorepo. Build vẫn biên dịch cả web và worker; deploy này chỉ phát hành
API Worker. Kiểm tra trước từ root: `node scripts/wrangler.mjs deploy --dry-run`.
Sau deploy, URL Worker `/health` trả hello world; `/v1/quotes` cần các secret Supabase
bên dưới. Thông báo dry-run `No bindings found` không phải lỗi, vì repo không ghi
giá trị secret vào config.

Giao diện Next.js xuất ra `web/out`, cần dự án **Pages** riêng. Nếu tạo Pages bằng
Git integration, chọn root repo, framework preset `None`,
build `npm run build --workspace web`, output `web/out`, `NODE_VERSION=24` và nhánh `main`.
Chọn một cơ chế CD cho mỗi ứng dụng: Workers Builds/Pages Git integration **hoặc**
job deploy GitHub Actions bên dưới. Nếu dùng hoàn toàn Git integration, đặt
repository variable `CF_DEPLOYMENT_MODE=git-integration` trong GitHub Actions
để bỏ qua job `deploy`, giữ job `verify`; tránh hai pipeline cùng deploy một
Worker/Pages. Để dùng CD Actions, bỏ trống biến mode và cấu hình `CF_PAGES_PROJECT`
cùng token/Account ID bên dưới. Chưa đặt Pages project thì job `deploy` SKIPPED;
job `verify` vẫn chạy đầy đủ, không bỏ qua kiểm thử để CI xanh.
Workers Builds chạy build riêng; không chứng minh check `verify` đã xanh trên GitHub.

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

`SUPABASE_SERVICE_ROLE_KEY` chỉ dùng trong scheduled handler ghi market data.
Phần đọc public dùng publishable key. Secret runtime đã đặt được giữ khi deploy;
workflow không in hay tự suy ra giá trị. Local đặt các tên Worker vào
`.dev.vars` ở gốc repo (ignored). `.env.example` liệt kê tên, không chứa giá trị secret;
web nếu cần dùng biến public thì tạo `web/.env.local` (ignored). Không copy nguyên
secret Worker sang biến `NEXT_PUBLIC_*`.

## GitHub Actions, CD và chặn merge đỏ

Workflow `.github/workflows/ci-cd.yml` chạy mọi pull request và push main:
`npm ci` → cài Gitleaks → `npm run verify` → smoke. Artifact giữ log/coverage và
static web đã build. Job deploy **needs verify**, chỉ push `main` khi đã cấu hình
`CF_PAGES_PROJECT` và không chọn mode `git-integration`, triển khai Worker rồi Pages
từ artifact đó. PR không nhận deployment secrets và không deploy.
API VPS live không chạy trong CI. CD chưa tự áp dụng migration cloud; dùng db push
được review trước khi deploy phiên bản cần schema mới.

Trong Settings → Secrets and variables → Actions, đặt:

| Loại     | Tên                   | Dùng cho                                                      |
| -------- | --------------------- | ------------------------------------------------------------- |
| Secret   | CLOUDFLARE_API_TOKEN  | Deploy Worker/Pages                                           |
| Secret   | CLOUDFLARE_ACCOUNT_ID | Chọn account                                                  |
| Variable | CF_PAGES_PROJECT      | Pages project Direct Upload đã tạo                            |
| Variable | CF_DEPLOYMENT_MODE    | `git-integration` bỏ qua CD Actions; để trống dùng CD Actions |

Bật Actions, thiết lập environment `production` chỉ cho nhánh `main`. Không cần
Supabase service key trong GitHub Actions vì migration CI dùng container và key
runtime nằm ở Cloudflare. Job deploy SKIPPED khi chưa đặt Pages project hoặc đã chọn
Git integration; khi đã bật CD Actions bằng Pages project, job sẽ lỗi rõ nếu thiếu
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

Giới hạn hiện tại: KBS/Vietcap có bar/BCTC mẫu thật, nhưng contract production,
price basis và mapping tài chính chưa xác minh; tin tức chưa có nguồn; lot × 10 mới đối chiếu ACB một ngày; đơn vị lastVolume
và timestamp sàn chưa rõ; app chỉ hello world, chưa có màn hình phân tích. Xem
`docs/data-sources.md`. Không mô tả CI trên GitHub, hosted migration hay deploy
thành công nếu chỉ chạy các kiểm thử local.

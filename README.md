# vn-stock-analyzer

Bộ khung Phần 1: Next.js + TypeScript strict + Tailwind, Workers API/Cron,
Supabase PostgreSQL/Auth/RLS và GitHub Actions. Chỉ hỗ trợ thị trường Việt Nam
(HOSE/HNX/UPCOM). Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.

Kiến trúc và sơ đồ Mermaid: [docs/architecture.md](docs/architecture.md).
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
Không có live check OHLCV hoặc báo cáo tài chính vì chưa có nguồn xác nhận.

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

Tên Worker mặc định `vn-stock-analyzer-api`, Cron trong `worker/wrangler.jsonc`.
Tài khoản Cloudflare và quyền network cần sẵn có để các lệnh ghi này chạy. CI
build/dry-run không tạo resource hay publish.

3. Tạo Worker secrets qua CLI/dashboard, nhập giá trị an toàn khi CLI hỏi:

```bash
node scripts/wrangler.mjs secret put SUPABASE_URL
node scripts/wrangler.mjs secret put SUPABASE_PUBLISHABLE_KEY
node scripts/wrangler.mjs secret put SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` chỉ dùng trong scheduled handler ghi market data.
Phần đọc public dùng publishable key. Secret runtime đã đặt được giữ khi deploy;
workflow không in hay tự suy ra giá trị. Local đặt các tên Worker vào
`worker/.dev.vars` (ignored). `.env.example` liệt kê tên, không chứa giá trị secret;
web nếu cần dùng biến public thì tạo `web/.env.local` (ignored). Không copy nguyên
secret Worker sang biến `NEXT_PUBLIC_*`.

## GitHub Actions, CD và chặn merge đỏ

Workflow `.github/workflows/ci-cd.yml` chạy mọi pull request và push main:
`npm ci` → cài Gitleaks → `npm run verify` → smoke. Artifact giữ log/coverage và
static web đã build. Job deploy **needs verify**, chỉ push `main`, triển khai Worker
rồi Pages từ artifact đó. PR không nhận deployment secrets và không deploy.
API VPS live không chạy trong CI. CD chưa tự áp dụng migration cloud; dùng db push
được review trước khi deploy phiên bản cần schema mới.

Trong Settings → Secrets and variables → Actions, đặt:

| Loại     | Tên                   | Dùng cho                           |
| -------- | --------------------- | ---------------------------------- |
| Secret   | CLOUDFLARE_API_TOKEN  | Deploy Worker/Pages                |
| Secret   | CLOUDFLARE_ACCOUNT_ID | Chọn account                       |
| Variable | CF_PAGES_PROJECT      | Pages project Direct Upload đã tạo |

Bật Actions, thiết lập environment `production` chỉ cho nhánh `main`. Không cần
Supabase service key trong GitHub Actions vì migration CI dùng container và key
runtime nằm ở Cloudflare. Job deploy sẽ lỗi rõ khi thiếu token/account/project.

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
worker/               Workers API, news scaffold, wrangler Cron
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

Giới hạn hiện tại: nguồn lịch sử/fundamentals/tin tức chưa xác nhận; lot × 10 mới đối chiếu ACB một ngày; đơn vị lastVolume
và timestamp sàn chưa rõ; app chỉ hello world, chưa có màn hình phân tích. Xem
`docs/data-sources.md`. Không mô tả CI trên GitHub, hosted migration hay deploy
thành công nếu chỉ chạy các kiểm thử local.

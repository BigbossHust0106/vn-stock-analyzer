# Bàn giao sửa review 20d3c99 trên main mới nhất — 14/10/2026

Bản review là `20d3c99`; đã fetch và ghép các sửa vào `main` mới hơn `fabc470`
(gồm `2804dc9` Phần4). Giữ Auth PKCE, Top10, watchlist và các migration Phần4.
Cả chín phát hiện đều được chấp nhận; không có bằng chứng vượt RLS ở phát hiện6.

## Lỗi → sửa → file/dòng → test → phần còn thiếu

| #   | Kiểm chứng lỗi và sửa                                                                                                                                          | File/dòng chính                                                                                                                                                            | Test hồi quy/đáp án độc lập                                                                                                                                                   | Phần còn thiếu                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Fixture VNM cho proxy38.079,86; giá20.000 trước sửa cấp điểm DCF. Tách kịch bản; DCF/MOS Buffett unknown; không phân bổ NCI                                    | `modules/strategies/buffett.ts:61`, `web/ui/scoring-panel.tsx`                                                                                                             | `review-regressions.test.ts`: CFO8668137049000−Capex1762010725000; g5%,r12%,terminal2%,N5,CP2089955445 =>38.079,86. Browser đối chiếu EPS/DCF/MOS độc lập, parent DCF unknown | Owner Earnings thuộc công ty mẹ chưa xác minh                                                                        |
| 2   | CSTC=[] trước sửa annual=[]. Ghép báo cáo độc lập, ratio=null. Guard API/DB giữ snapshot tốt                                                                   | `modules/providers/financial-schema.ts:181`, `financial-types.ts:118`, `worker/src/api/financials.ts:61`                                                                   | Thiếu CSTC vẫn4 năm, EPS2025=4028; JS/SQL rỗng/mất ROE không ghi đè                                                                                                           | Khi có số liệu mới nhưng thiếu trường, giữ bản tốt và thông báo; không trộn kỳ/nguồn                                 |
| 3   | KBS giữ thứ tự nguồn. Sort tăng dần ngày phiên                                                                                                                 | `modules/providers/kbs-provider.ts:125`                                                                                                                                    | Nguồn13→9→12/10; output9→12→13; close9/10/11, volume10/20/30                                                                                                                  | Không tự tạo phiên thiếu                                                                                             |
| 4   | Engine dùng fetchedAt làm freshness; cron16:00 không đọc lịch; finality suy từ ngày. Tách quoteEvidence, guard mọi cron, bỏ finality suy đoán                  | `modules/scoring/engine.ts:54`, `worker/src/index.ts:198`, `market-sync.ts:27`, `trading-sync.ts`, `market-schema.ts:153`                                                  | Tải hôm nay vẫn risk timestamp nguồn; cron16:00 ngày nghỉ/thiếu lịch/chưa đóng phiên không gọi nguồn; intraday/EOD ngày nghỉ cũng bỏ tải                                      | Timestamp nguồn/lịch phiên/finality production chưa xác minh; cron không coi ngày thường là phiên                    |
| 5   | Hai write BCTC/điểm có thể lệch. Một RPC transaction; khóa/kiểm tra quote version, lưu financial/quote UUID và input JSON. Top10 cũng lưu input quan sát được  | `worker/src/financial-sync.ts:33`, migration `202610140001_review_integrity.sql:42`, `worker/src/ranking-sync.ts`, migration `20261014070000_ranking_input_provenance.sql` | Client chỉ1 RPC; score101 bị constraint làm rollback EPS về4, điểm80 và financial version cũ; stale quote bị từ chối; SQL Top10 lưu exact input metadata                      | Bản ghi lịch sử trước migration có version/input null; không tự tái tạo provenance                                   |
| 6   | Owner localStorage cũ không theo Auth expiry/logout. Owner chỉ từ Auth trong bộ nhớ, onAuthStateChange/expiry/storage; chống request A về muộn; giữ PKCE Phần4 | `web/lib/scoring-settings.ts:142`, `modules/settings/session-preferences.ts`, `web/ui/auth-provider.tsx`                                                                   | Unit expiry/owner giả/request cũ/shared storage; hosted JWT A/B RLS; browser hai tab A70/30 → guest50/50 → B30/70 → guest50/50 không reload tab phụ                           | Google provider chưa bật; logout từ thiết bị khác chỉ quan sát được khi SDK biết trạng thái/refresh hoặc JWT hết hạn |
| 7   | Upsert không vô hiệu mã mất. RPC đối soát transaction, reactivation và guard batch thiếu/giảm bất thường                                                       | `worker/src/market-sync.ts:40`, `scripts/sync-market.ts`, migration integrity:78                                                                                           | Catalog150→149: T001 inactive; batch incomplete/truncated giữ149; mã trở lại active                                                                                           | Không thể chứng minh nguồn toàn bộ chỉ từ HTTP200; thay đổi lớn cần đối chiếu                                        |
| 8   | Browser chỉ nhìn thành phần nhưng log nêu số liệu; thiếu nhánh16:00. Assertion số EPS/Graham/DCF/MOS/MA/volume độc lập, log đúng phạm vi                       | `scripts/browser-scoring.ts`, `scripts/browser-market.ts`, `tests/unit/cron.test.ts:98`                                                                                    | Local browser chạy code hiện tại+Supabase/nguồn thật; EPS4028/5216/1973; MA trung bình nến nguồn; latest daily volume; policy DCF unknown; mọi nhánh cron nghỉ                | Chưa chứng nhận mọi timeframe bằng số, chỉ kiểm tra controls/canvas; không gọi đó là numeric PASS                    |
| 9   | currentShares=null trước sửa báo số CP thay đổi. Tách thiếu dữ liệu với thay đổi được đối chiếu                                                                | `modules/scoring/engine.ts:100`                                                                                                                                            | currentShares=null phải có “Thiếu số cổ phiếu”, không có “Số cổ phiếu thay đổi”                                                                                               | Giá/EPS/BVPS sau chia tách vẫn cần nguồn đối chiếu                                                                   |

## ĐÃ XÁC MINH BẰNG MÁY

Kết quả nguyên văn `npm run verify` được lưu tại
[verify-review-2026-10-14.txt](verify-review-2026-10-14.txt). Bảng9 bước và số test
trong file là kết quả chạy thật, không phải kế hoạch kiểm tra.

Unit suite sau ghép main:104 PASS. Công thức toán trong `tests/unit/finance.test.ts`
không đổi. Khi DCF chuyển unknown, assertion **chính sách điểm/coverage** được cập
nhật theo yêu cầu1: biên Graham vẫn57,8362978644%, đáp án40% vẫn23,134; một nửa
trọng số định giá dành cho DCF thiếu đóng góp0, nên điểm tháng11,567 và coverage20%.
Không sửa EPS/Graham/DCF/RSI/ATR/MACD để khớp implementation.

Lượt verify cuối đạt9/9:104 unit PASS,36 provider PASS,1 TODO `lastVolume`;
coverage lines/functions100%, statements99,59%, branches97,82%. Cả8 migration
và RLS PostgreSQL17 PASS. `npm run smoke` PASS web/worker HTTP200, input400,
thiếu Supabase503. Lượt verify trước dừng ở Prettier; đã định dạng lại và chạy
lại toàn bộ, không coi các bước NOT RUN của lượt thất bại là PASS.

Migration `20261014070000_ranking_input_provenance` đã áp dụng thật trên Supabase;
đã đọc lại score Top10 xác nhận financial/quote version và input JSON có lưu.
Log browser/Auth nguyên văn: [live-review-2026-10-14.txt](live-review-2026-10-14.txt).

Browser local (build trỏ Worker local8878, Supabase thật; không fixture production):
VNM/FPT/HPG EPS số, Graham, kịch bản DCF/MOS, parent DCF unknown, trọng số100/0
reload, MA20/50/200 trung bình độc lập, daily volume, mobile390px, không JS error.
Auth/watchlist/Top10 hosted dùng JWT2 user tạm, không service-role để thử RLS;
user tạm được xóa sau test. Các kiểm tra browser/hosted là lệnh riêng ngoài CI.

**Trạng thái sau tính lại xếp hạng bằng engine đã sửa:** day16, month8, quarter16
ứng viên. `npm run verify:phase4:live` chạy lại sau sync **FAIL** với thông báo
`Chưa đủ 10 cổ phiếu thật: month`; Auth/RLS/day trước đó PASS, cleanup PASS.
PASS browser Top1010 dòng trong log phía trên là lượt **trước lần tính lại**,
không được coi là chứng minh bảng tháng hiện tại có10 mã. Không sửa assertion10
thành8 để che thiếu tiêu chí hoàn thành Phần4, không cấp điểm DCF proxy cho đủ10.
Đã thử tải12 snapshot còn thiếu trong universe35, cả12 không đủ contract hợp lệ.
Ví dụ DGC KQKD2025 có PeriodBegin=`202531`, PeriodEnd=`202511`; SAB/QNS ratios
có record thiếu ticker. Chưa có bằng chứng để sửa metadata hay đoán định nghĩa.
Phần4 chưa đạt tiêu chí ba bảng đủ10 ở snapshot này.

## CHƯA XÁC MINH / GIẢ ĐỊNH

- BCTC KBS/Vietcap là provider_reported, chưa chứng nhận PDF gốc/ROIC definition.
- Chưa có dòng tiền công ty mẹ, maintenance Capex và lịch sử điều chỉnh đủ bằng chứng.
- `lot × 10` đối chiếu ACB một ngày; `lastVolume` vẫn TODO, giữ raw.
- Không dùng fetchedAt, sequence, transId để giả timestamp sàn. UUID version chỉ
  nhận diện observation đã ingest, không chứng nhận nguồn hay phiên.
- Google Auth thực tế vẫn tắt ở project đã cho; chưa chạy consent/callback Google.
- Lịch nghỉ thanh toán VSDC không tự chứng minh lịch giao dịch từng sàn; cron
  thiếu lịch có nguồn thì dừng. Chưa có chứng cứ scheduler chạy production đúng giờ.
- Browser production từng FAIL timeout30s rồi300s ở endpoint thị trường của bản
  đang phát hành. Không gán các PASS local của bản mới cho URL production.

## LỖI TỰ TÌM THẤY VÀ ĐÃ SỬA

- Nhánh EOD mới của Phần4 vẫn nâng finality từ thời điểm tải; bỏ việc nâng này.
- Nếu sync16:00 bỏ qua ngày nghỉ, nhánh `.then` vẫn có thể chạy ranking; trả boolean
  và chỉ tính ranking khi có đồng bộ thực sự.
- AuthProvider Phần4 có luồng tải preferences riêng có thể ghi đè state mới; dùng
  cùng Auth-derived preference store và bỏ luồng ghi owner cũ, giữ getUser cho route.
- Response cloud cũ có thể đè lựa chọn vừa lưu; generation tăng khi write.
- Lỗi screenshot chẩn đoán có thể bỏ qua cleanup user tạm; diagnostics có timeout
  và catch, vẫn cleanup Auth. Đã cleanup2 user của lượt bị ngắt.
- Bản sao build của review ban đầu FAIL chưa có cơ sở quy lỗi source. Build mới
  chạy thật trong verify; báo kết quả chính xác trong log.

## RỦI RO CÒN LẠI

Endpoint VPS không chính thức có thể bị chặn/đổi schema và gây retry chậm. Lịch sử
unverified không dùng cho scoring kỹ thuật; Top10 vẫn công bố thiếu nhóm tiêu chí
thay vì bịa dữ liệu. BCTC/điểm transaction theo mã, không transaction toàn thị trường.
Catalog guard có thể từ chối thay đổi lớn hợp lệ để cần đối chiếu nguồn.

Cloudflare Workers Builds từng báo token build đã bị xóa/rolled trước khi chạy
source (`docs/handover-phase4.md`). Push GitHub, build local và deploy Cloudflare
là ba kết quả riêng; không tuyên bố production cập nhật nếu chưa xác nhận.
Read-only Workers namespace với credential hiện có trả HTTP401 ngày14/10/2026.
Chưa có quyền deploy sử dụng được cho URL cũ; cần chủ tài khoản sửa build token
hoặc cấp credential đúng account qua Environment Secrets. Google vẫn tắt, cần
lưu Client ID/Secret và Enable provider ở đúng Supabase project, không gửi secret
trong chat.

## CÁCH ĐỂ TÔI TỰ KIỂM TRA

1. `npm ci`, `npm run tools:install`; Docker phải chạy; `npm run verify` phải9/9PASS.
2. Với cấu hình public trong `.cache/connection.env`, build local:
   `NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8878 npm run build --workspace web`,
   `npm run dev:market`; chạy `npm run verify:scoring:browser`,
   `npm run verify:browser:live`. Lệnh cần Chromium/trust CA hợp lệ.
3. `npm run verify:phase4:live -- --browser` dùng Supabase Management credential qua
   Environment Secrets để tạo/xóa2 user tạm, kiểm tra JWT/RLS/watchlist/Top10/Auth
   nhiều tab. Không gửi credential trong chat hay commit file env.
4. `/stocks?symbol=VNM`: DCF công ty mẹ “Không đủ dữ liệu”, tiêu chí unknown; proxy
   nằm ở kịch bản riêng. EPS năm không nhân1000; `lastVolume` không chuẩn hóa.
5. `/settings` hai tab: đăng nhập A, đổi trọng số; logout ở tab1 thì tab2 về khách;
   login B phải nhận preferences B. Watchlist A/B vẫn tách bằng RLS.
6. Trước vận hành cron, import lịch phiên có URL/bằng chứng đã đối chiếu; không
   seed lịch mở phiên từ weekdays. Sau phát hành, kiểm tra Google enabled và build
   Cloudflare trước khi thử OAuth/production browser.

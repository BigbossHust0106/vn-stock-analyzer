# BCTC cho Top 10 — rà soát và sửa 16/10/2026

## Nguyên nhân Top 10 thiếu BCTC (đã xác minh)

1. **BCTC không bao giờ tự cập nhật.** `syncFinancials` chỉ chạy bên trong
   `syncMarket` (Cron `0 9 * * 1-5`), mà `syncMarket` dừng ngay khi bảng
   `trading_sessions` không có lịch hôm đó. Lịch đang trống nên job BCTC không
   chạy. BCTC không phụ thuộc phiên giao dịch nên không cần chặn theo lịch.
   Ngoài ra một lượt 35 mã × ~18 subrequest vượt xa ngân sách 50 subrequest/lượt
   của Workers Free.
2. **Vietcap dùng `organCode` nội bộ khác mã CK.** Ví dụ QNS → `QNSC`, SAB →
   `SBCO`. Adapter cũ so `organCode` với mã CK nên từ chối toàn bộ BCTC của QNS,
   SAB, SIP, IDC, VEA.
3. **KBS ghi sai kỳ báo cáo năm 2025** ở một số mã: REE/MSN/TRC ghi
   `PeriodBegin=202501, PeriodEnd=202612`; DGC ghi `202531–202511`. Adapter cũ
   ném lỗi cho cả mã nên mất luôn các năm 2022–2024 hợp lệ.

Đo thật lúc 07:24–07:31 UTC: 35 mã universe, 24 có BCTC, 11 lỗi (DGC, REE, QNS,
IDC, VEA, SAB, MSN, TRC, DHG, SIP lỗi tải; NT2/IMP không có năm hợp nhất).
Lưu ý: các lệnh đo gọi `GET /v1/financials/{mã}` công khai; endpoint này theo
thiết kế tự làm mới snapshot >24 giờ, nên lần đo đã làm mới BCTC của các mã tải
được (giống một người dùng mở trang chi tiết).

## Đã sửa

- **Cron BCTC độc lập lịch phiên** (`refreshStaleFinancials`, chạy cuối Cron
  `*/5 * * * *`, cả cuối tuần): mỗi lượt làm mới **1 mã** có snapshot >25 giờ (lớn hơn cache 24 giờ của adapter)
  (mã chưa có snapshot trước, rồi mã cũ nhất), xoay vòng theo lượt 5 phút để mã
  lỗi liên tục không chặn mã khác. 35 mã được làm mới trong ~3 giờ; khi tất cả
  còn mới, lượt rảnh làm mới kho dự phòng Vietcap (>24 giờ). Lỗi bước này không
  làm hỏng cảnh báo/VPS (chạy sau, có `catch`). Ghi `system_status.fundamentals`.
  Không cần migration.
- **Ánh xạ organCode Vietcap có xác minh:** chỉ khi ratios trả organCode khác mã,
  adapter gọi `GET iq.vietcap.com.vn/api/iq-insight-service/v1/company/{mã}`
  (đã gọi thật: QNS → `{ticker:"QNS", organCode:"QNSC"}`) và chỉ nhận khi
  `ticker` trùng mã được hỏi.
- **Kỳ KBS sai định dạng:** không còn làm hỏng cả mã. Năm có PeriodBegin/End sai
  chỉ được nhận khi (a) ít nhất 2 năm khác của cùng báo cáo là năm dương lịch
  chuẩn và (b) LNST/Doanh thu thuần của KBS khớp `afterTaxProfitMargin` của
  Vietcap cùng năm trong 0,0001. Thực đo REE/DGC 2022–2025 lệch ~1e-11. Năm
  được nhận có ghi chú **“giả định, chưa đối chiếu PDF”**; năm không khớp bị bỏ
  riêng, không tự sửa kỳ. Kỳ quý (`TermCode` khác `N`) vẫn bị từ chối toàn bộ.
- Thử lại bằng adapter mới (gọi thật): REE, QNS, SAB, MSN, TRC, DGC, SIP, IDC,
  VEA đều ra đủ 4 năm 2022–2025. DHG vẫn không có năm hợp nhất (xem dưới).
- **Bảng tham khảo trên `/top10`** (`reference-v1`, tách riêng khỏi Top 10
  chuẩn `complete-v1`): chỉ hiện khi Top 10 chuẩn chưa đủ 10 mã; chỉ nhận mã đã
  qua lọc BCTC/giá/vốn hóa, có điểm, bao phủ ≥30%; không bù trọng số phần thiếu;
  mỗi dòng ghi “Còn thiếu: …”. Không đổi tiêu chí của Top 10 chuẩn.
- `syncFinancialBackup` tạo provider theo lượt gọi để dùng transport hiện hành
  (trước đây giữ `fetch` lúc import khiến unit test có thể gọi mạng thật).

## Nguồn đã thử nhưng không dùng (16/10/2026)

| Nguồn                 | Kết quả gọi thật                                                                        | Quyết định                                                           |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| FireAnt `restv2`      | `full-financial-reports`, `financial-indicators`, `fundamental`: HTTP 401 cần token     | Sau đó có token người dùng: dùng làm **dự phòng** (xem mục Bổ sung). |
| HOSE `hsx.vn`         | Trang SPA, BCTC công bố dạng tin/PDF; không có API BCTC có cấu trúc công khai           | Không tự trích PDF; giữ cơ chế bằng chứng tài liệu hiện có.          |
| HNX `hnx.vn`          | TLS lỗi chuỗi chứng chỉ (`unable to get local issuer certificate`) qua CA chuẩn         | Không tắt kiểm tra TLS; không dùng làm nguồn tự động.                |
| Vietstock Finance     | Trang HTML ~1,2 MB, dữ liệu BCTC qua phiên/token web                                    | Không cào HTML.                                                      |
| KBS + Vietcap (đã có) | KBS 200 khi có User-Agent (curl mặc định bị chặn, adapter đã gửi UA riêng); Vietcap 200 | Giữ làm nguồn chính; sửa parser như trên.                            |

Cập nhật cùng ngày: người dùng cung cấp token FireAnt, đã khảo sát response thật và
thêm adapter dự phòng — xem mục “Bổ sung” bên dưới.

## Còn lại / rủi ro

- **Công ty chỉ có BCTC riêng lẻ** (NT2, IMP, DHG năm 2025 theo KBS): RPC
  `persist_financial_score` và `availableAnnual` chỉ nhận BCTC hợp nhất. Muốn
  hỗ trợ cần migration + quyết định chính sách; chưa làm vì migration không tự
  áp dụng lên production.
- Top 10 **chuẩn** vẫn có thể rỗng: cần giá có thời điểm nguồn + lịch phiên đã
  xác minh, lịch sử phiên cho chỉ báo kỹ thuật, và LLM tin tức. Đây là giới hạn
  thiết kế `complete-v1`, không phải lỗi BCTC; Bảng tham khảo giúp dùng được
  trong lúc chờ.
- Ngân sách subrequest mỗi lượt maintenance (~20 hiện có + ~16 cho 1 mã BCTC)
  là ước tính theo code, chưa đo trên Cloudflare. Nếu vượt, chỉ bước BCTC lỗi,
  các bước khác đã chạy xong trước đó.
- KBS/Vietcap là endpoint web không chính thức, không SLA.

Log `npm run verify` nguyên văn: [verify-financial-sources-2026-10-16.txt](verify-financial-sources-2026-10-16.txt).

## Bổ sung: BCTC dự phòng FireAnt (`FIREANT_VIETCAP`)

Gọi thật 16/10/2026 bằng token người dùng cung cấp (token không nằm trong repo):
`restv2.fireant.vn/symbols/{mã}/full-financial-reports?type=1|2|4&year=Y&quarter=0&limit=4`
trả HTTP200 (~1,3–2,6 giây), 4 năm 2022–2025, đơn vị **đồng**. `type=3` trả `null`,
`type=5` HTTP500. Đối chiếu VNM 2025 với KBS: doanh thu, LNST, LNST công ty mẹ, tài sản
ngắn hạn, nợ ngắn/dài hạn, vốn chủ, lợi ích CĐ không kiểm soát, CFO, capex, cổ tức đều
lệch < 1.000 đ (KBS làm tròn nghìn đồng).

- **Chỉ dùng khi KBS lỗi hoặc không có kỳ năm hợp lệ**; không trộn hai nguồn trong
  một snapshot. Snapshot FireAnt thiếu Nợ vay/VCSH nên không ghi đè snapshot KBS đầy
  đủ (guard suy giảm hiện có).
- FireAnt không có EPS cơ bản đã công bố (chỉ số `BasicEPS` 4.502 = LNST/số CP, khác
  EPS công bố 4.028), ngày công bố, cờ kiểm toán/hợp nhất. Vì vậy EPS năm và ngày công
  bố lấy từ Vietcap `INCOME_STATEMENT` (`isa23`, `publicDate`); một năm chỉ được nhận
  khi LNST công ty mẹ FireAnt khớp Vietcap `isa22` trong 0,01%.
- Hợp nhất: chỉ nhận năm có lợi ích CĐ không kiểm soát khác 0. **Giả định:** BCTC năm
  công bố sau kỳ là bản kiểm toán. DHG/NT2 (riêng lẻ) bị loại; QNS (hợp nhất nhưng
  không có CĐ thiểu số) cũng bị loại — sai âm bảo thủ.
- ROEA/ROAA/biên gộp/biên ròng tính lại theo đúng định nghĩa KBS và khớp KBS VNM 2025
  (29,89% / 17,37% / 41,18% / 14,79%). Nợ vay/VCSH để trống.
- Mỗi mã dự phòng tốn 5–6 request (3 FireAnt + 2–3 Vietcap).

### Bật trên production (bạn tự làm, 2 bước)

1. Áp dụng migration `supabase/migrations/20261016100000_fireant_financial_fallback.sql`:
   Supabase Dashboard → SQL Editor → dán toàn bộ nội dung file → Run. Chưa áp dụng thì
   DB từ chối snapshot FireAnt và giữ dữ liệu cũ (không lỗi trang).
2. Cloudflare Dashboard → Workers & Pages → `vn-stock-analyzer` → Settings → Variables
   and Secrets → Add → Type **Secret**, tên `FIREANT_API_TOKEN`, giá trị là token (không
   kèm chữ `Bearer`). Lưu sẽ tạo bản deploy mới.

Token là phiên đăng nhập cá nhân FireAnt có quyền ghi lệnh/tài khoản; có thể bị FireAnt
thu hồi bất kỳ lúc nào. Khi đó web tự quay về chỉ dùng KBS + snapshot cũ.

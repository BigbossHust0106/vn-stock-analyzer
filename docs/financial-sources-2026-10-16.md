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

| Nguồn                 | Kết quả gọi thật                                                                        | Quyết định                                                              |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| FireAnt `restv2`      | `full-financial-reports`, `financial-indicators`, `fundamental`: HTTP 401 cần token     | Không dùng token nhúng trong web FireAnt. Cần gói API/token chính thức. |
| HOSE `hsx.vn`         | Trang SPA, BCTC công bố dạng tin/PDF; không có API BCTC có cấu trúc công khai           | Không tự trích PDF; giữ cơ chế bằng chứng tài liệu hiện có.             |
| HNX `hnx.vn`          | TLS lỗi chuỗi chứng chỉ (`unable to get local issuer certificate`) qua CA chuẩn         | Không tắt kiểm tra TLS; không dùng làm nguồn tự động.                   |
| Vietstock Finance     | Trang HTML ~1,2 MB, dữ liệu BCTC qua phiên/token web                                    | Không cào HTML.                                                         |
| KBS + Vietcap (đã có) | KBS 200 khi có User-Agent (curl mặc định bị chặn, adapter đã gửi UA riêng); Vietcap 200 | Giữ làm nguồn chính; sửa parser như trên.                               |

Muốn thêm FireAnt: mua/đăng ký API, đặt secret `FIREANT_API_TOKEN` trong
Cloudflare (không commit), rồi giao một phần việc để khảo sát schema thật và
viết adapter + fixture. Không viết adapter khi chưa thấy response thật.

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

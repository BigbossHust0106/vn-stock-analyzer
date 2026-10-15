# Nguồn BCTC và dự phòng — kiểm tra 15/10/2026

## Nguồn sử dụng được

| Nguồn                         | Vai trò hiện tại                                                              | Bằng chứng và giới hạn                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KBS KB Buddy                  | BCTC chuẩn hóa chính: CDKT, KQKD, LCTT, CSTC; metadata năm/hợp nhất/kiểm toán | Adapter cũ giữ nguyên kiểm tra nhãn, đơn vị, kỳ và guard chống snapshot suy giảm. Đã đồng bộ thật DPR/FPT/HPG/VNM, 4 năm 2022–2025. Không coi metadata nhà cung cấp là đã đối chiếu toàn bộ PDF.                                                                         |
| Vietcap IQ ratios             | ROIC và số cổ phiếu, phân biệt năm với TTM                                    | Đã có contract và fixture; không thay EPS năm bằng EPS TTM, không tự điều chỉnh cổ phiếu.                                                                                                                                                                                |
| Vietcap IQ statements         | **Kho báo cáo dự phòng tách riêng**: balance sheet/income statement/cash flow | Request thật VNM trả HTTP200, 8 năm 2018–2025. Đã lưu thêm DPR/FPT/HPG/VNM vào Supabase. Chỉ lưu chỉ tiêu raw; chưa xác minh đầy đủ đơn vị, phạm vi hợp nhất và trạng thái kiểm toán. `usableForScoring=false`. Không trộn vào snapshot KBS hoặc tự thay Owner Earnings. |
| BCTC gốc công ty / HOSE / HNX | Nguồn đối chiếu ưu tiên cho số liệu đặc thù, như dòng tiền công ty mẹ         | Cơ chế bằng chứng tài liệu có sẵn, gồm DPR. Chưa có bộ trích xuất tự động đáng tin cậy cho mọi mẫu PDF; không suy ra CFO mẹ từ tỷ lệ vốn thiểu số.                                                                                                                       |

KBS và Vietcap là hai endpoint khác nhau. Chưa chứng minh nhà cung cấp dữ liệu gốc của chúng độc lập; không gọi đây là hai cuộc kiểm toán độc lập. Khi KBS lỗi, giữ snapshot chuẩn hóa tốt đã lưu. Vietcap phục vụ lưu trữ/đối chiếu và chuẩn bị phục hồi; chưa được thay nóng làm đầu vào chấm điểm khi chưa đủ contract tài chính.

## Endpoint gọi thật trước khi tích hợp

```text
GET https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{symbol}/financial-statement
    ?section={BALANCE_SHEET|INCOME_STATEMENT|CASH_FLOW}
```

Khảo sát VNM: balance sheet HTTP200 ~3113ms, income statement HTTP200 ~2803ms, cash flow HTTP200 ~5198ms. Đây là một mẫu đo, không phải SLA. Payload có `successful`, `status`, `data.years`, `data.quarters`; mỗi kỳ có `ticker`, `yearReport`, `lengthReport`, `publicDate` và các mã trường số. Adapter chỉ nhận `data.years`, `lengthReport=5`; xác nhận mã, năm không trùng, ngày và kiểu số/null. Không dùng `quarters` cho chuỗi năm; không tự gán nhãn cho hàng trăm mã chỉ tiêu. Ví dụ đã đối chiếu trong fixture: `isa23=4028` ở VNM 2025, giữ nguyên raw, không nhân1000.

Nguồn khám phá endpoint: mã nguồn công khai `vnstock/explorer/vci/financial.py` và `const.py` tại https://github.com/thinh-vu/vnstock . Sau đó đã gọi trực tiếp; không sao chép mã thư viện vào adapter. Fixture thật đã lưu từ Phần3 được dùng lại cho hồi quy.

Cache nguồn 24 giờ, nhịp tối thiểu1 request/giây, timeout10 giây, retry1 lần có backoff. Đây là giới hạn tự đặt, **chưa biết quota nguồn**. Cron BCTC thử cập nhật kho raw; nguồn lỗi giữ bản cũ và lưu thông báo lỗi. Không tải thêm cả kho báo cáo trên đường mở trang. Bảng `financial_report_backups` có RLS đọc công khai, chỉ service role ghi; từ chối bản rỗng, bản cũ, mất trường số hoặc lùi kỳ. Kho raw và BCTC chuẩn hóa có vòng đời riêng.

Endpoint web không chính thức, có thể thay schema, hạn chế quyền dùng lại hoặc bị chặn. Không có cam kết dịch vụ hay quyền phân phối thương mại được xác nhận trong lần kiểm tra này.

## Nguồn đã tìm nhưng chưa dùng được

| Ứng viên                   | Kết quả / việc còn thiếu                                                                                                                                                                 | Quyết định                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| TCBS tcanalysis cũ         | Cả `incomestatement`, `balancesheet`, `cashflow` của VNM trả HTTP404 `Service not found`, lần lượt1276/728/376ms. Endpoint được tìm từ lịch sử mã nguồn công khai vnstock trước khi gọi. | Không cấu hình làm fallback hoạt động, không bịa response.           |
| SSI / FiinGroup            | Nguồn thương mại/có xác thực là ứng viên cần hợp đồng, credential và contract từng chỉ tiêu. Chưa xác minh một API BCTC có quyền truy cập trong môi trường này.                          | Đề xuất bổ sung khi có quyền; không tự lấy market data API làm BCTC. |
| WiFeed / Vietstock Finance | Ứng viên khảo sát thêm. Chưa có response BCTC và điều kiện sử dụng được kiểm chứng cho adapter hiện tại.                                                                                 | Không quảng bá là đã tích hợp.                                       |

```text
GET https://apipubaws.tcbs.com.vn/tcanalysis/v1/finance/VNM/{incomestatement|balancesheet|cashflow}?yearly=1&isAll=true
=> HTTP404, không khả dụng tại thời điểm khảo sát.
```

Thêm nhiều tên nguồn không đồng nghĩa dữ liệu tốt hơn: phải xác minh đơn vị đồng/nghìn đồng, công ty mẹ/hợp nhất, EPS năm/TTM, trạng thái kiểm toán, cơ sở điều chỉnh trước khi nhập vào chấm điểm.

## Lệnh tự kiểm tra

- `npm run verify:financial-backups:live`: gọi thật ba báo cáo cho VNM/FPT/HPG, in các kỳ và trạng thái raw; tách khỏi CI.
- `SYNC_SYMBOLS=VNM,FPT,HPG,DPR npm run sync:financials -- --migrate`: lưu backup, đồng bộ nguồn chính và điểm bằng RPC nguyên tử hiện có. Cần quyền quản trị Supabase qua biến môi trường.
- `npm run verify`: kiểm tra parser bằng fixture thật, migration và RLS; không gọi nguồn tài chính thật trong CI.

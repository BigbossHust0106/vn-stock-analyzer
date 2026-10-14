# DPR và điều kiện so sánh của Top 10 — 14/10/2026

Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.

## Kết quả kiểm tra

Dữ liệu đang lưu có BCTC năm 2022–2025. Các chỉ số ROE, ROIC, biên gộp/ròng,
nợ vay và FCF có số liệu; “Không đạt” không phải thiếu dữ liệu. Phần chưa đủ
bằng chứng là cổ tức thuộc công ty mẹ, Owner Earnings/DCF Buffett và thời điểm
nguồn của giá giao dịch. Không thể dùng điểm tạm này để tuyên bố DPR tốt hơn mã khác.

Trước bản sửa, bảng ngày có 16 ứng viên với độ bao phủ 15%, tháng 8 ứng viên với
20–40%, quý 16 ứng viên với 70%; độ tin cậy 12–19%. Đây là lỗi điều kiện xếp hạng:
chỉ cần có một nhóm điểm là đã được đưa vào bảng. Tổng điểm cố định vẫn bị ảnh
hưởng bởi mức thiếu dữ liệu khác nhau giữa các mã.

## Số liệu gốc đã bổ sung

Đọc trực tiếp dòng 20, 21, 36 của **BCTC riêng**, đơn vị VND. Capex và cổ tức là
khoản chi trên báo cáo, được lưu dưới dạng số dương; không cộng vào CFO.

| Năm  | CFO công ty mẹ (VND) | Capex công ty mẹ (VND) | Cổ tức đã trả của công ty mẹ (VND) |
| ---- | -------------------: | ---------------------: | ---------------------------------: |
| 2023 |       18.240.193.458 |         68.790.353.188 |                    130.823.850.850 |
| 2024 |      251.145.705.262 |         69.021.280.190 |                    129.878.461.200 |
| 2025 |      185.871.276.131 |         47.675.850.674 |                    173.304.337.550 |

- [BCTN 2024 do DPR công bố, trang PDF 139 / trang in 9 của BCTC riêng](https://doruco.com.vn/data/upload_file/File/Nam%202025/EN_Annual%20Report%202024%20%28F%29.pdf#page=139): cột năm 2024 và so sánh 2023. SHA-256 `a6230821b1145347abe4c43e5c236a3dcf93cf679c638af290ead065204d8a27`.
- [BCTC riêng kiểm toán 2025 do DPR công bố, trang PDF 11 / trang in 9](https://doruco.com.vn/data/upload_file/File/Th%C3%B4ng%20Tin%20C%E1%BB%95%20%C4%90%C3%B4ng%202026/Audited%20Separate%20Financial%20Statements%202025.pdf#page=11): năm 2025 và so sánh 2024. SHA-256 `49e986c03452e774e035c401646daf39305d5c59c95341ade2c693563cf5bc33`.

Cổ tức hợp nhất 2025 trong nguồn cũ là 173.553.738.000 VND, khác cổ tức công ty
mẹ 173.304.337.550 VND. Không chia theo tỷ lệ vốn thiểu số hoặc lấy số hợp nhất
thay số công ty mẹ. Chỉ 9 quan sát trên đã được đối chiếu PDF, **không chứng nhận
toàn bộ BCTC**. Dữ liệu và nguồn lưu tại `data/financial-evidence/DPR.json`;
bằng chứng chỉ được dùng từ thời điểm kiểm tra 14/10/2026 16:11:11 giờ Việt Nam,
không áp ngược cho backtest trước đó.

## Điều kiện mới

- Giữ nguyên phép tính và trọng số để không đổi đáp án tài chính cho khớp số mong muốn.
- Điểm tạm vẫn dùng để giải thích từng tiêu chí; chỉ đưa vào `rankings` khi đủ 100%
  trọng số kỳ, bộ lọc cơ bản, các tiêu chí tài chính bắt buộc và giá có timestamp/phiên
  nguồn được xác minh. Ngày dùng lọc tài chính tối thiểu theo nhiệm vụ; tháng/quý
  yêu cầu đủ cả hai bộ tiêu chí Graham/Buffett.
- Tháng còn yêu cầu bằng chứng phạm vi lịch sự kiện; không có tin trả về chưa đủ
  chứng minh không có sự kiện. Tháng/quý chưa có DCF Buffett thì không đủ điều kiện.
- Chặn tại cả SQL xuất bản lẫn RPC đọc, gồm dữ liệu cũ không có metadata chất lượng.
- Mã chưa đủ dữ liệu xuất hiện trong bảng bằng chứng sắp theo mã, **không có thứ hạng**;
  có phần còn thiếu, link chi tiết và nút theo dõi. Không thêm mã để lấp đủ 10.
- UI mở bảng tài chính và hiển thị giá trị từng năm bên cạnh tiêu chí, phân biệt
  “Không đạt” và “Thiếu dữ liệu”; điểm chưa đủ bằng chứng ghi rõ “tạm tính”.
- Giữ điểm/đầu vào lịch sử để kiểm toán; xóa các vị trí xếp hạng không đủ bằng chứng.
  Trạng thái cập nhật là `degraded` nếu chưa có 10 mã đủ dữ liệu ở cả ba kỳ.
- Bằng chứng PDF được lưu cùng snapshot và đầu vào điểm; API/cron cũ không được
  ghi đè làm mất các năm đã có bằng chứng.

## Phần chưa thể bổ sung thành dữ liệu đã xác minh

CFO và Capex riêng không tự trở thành Owner Earnings. Còn thiếu phân tách Capex
duy trì/tăng trưởng, dòng tiền có thể phân phối cho cổ đông và các điều chỉnh
liên quan; dự báo tăng trưởng/chiết khấu luôn là giả định mô hình. Không biến kịch
bản CFO hợp nhất thành giá trị nội tại Buffett đã xác minh. Giá VPS chưa có thời
điểm nguồn, lịch phiên và basis lịch sử chưa có bằng chứng xác nhận.

Vì vậy việc loại DPR ra khỏi Top 10 không có nghĩa DPR xấu, và việc hiển thị đủ
các trường số trên không đồng nghĩa đã hoàn tất dữ liệu cho mọi chiến lược.
Bảng xếp hạng có thể rỗng cho đến khi nguồn đáp ứng đầy đủ điều kiện. Đây là trạng
thái thiếu đầu vào thật, không phải lỗi giao diện hay lý do để tạo dữ liệu giả.

Truy vấn kiểm toán: `docs/data-quality-dpr.sql`. Kiểm thử: `npm run verify` và
`npm run verify:ranking-quality:live` (gồm browser khi thêm `-- --browser`).

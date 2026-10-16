# Hướng dẫn sử dụng VN Stock

Bản đầy đủ có link trực tiếp nằm ở trang **`/huong-dan`** của website
(<https://vn-stock-analyzer.manhhuong.workers.dev/huong-dan>), mở được cả khi chưa
đăng nhập. **Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.**

## 1. Bắt đầu

1. Mở website → **Đăng ký ngay** (email + mật khẩu) hoặc **Tiếp tục với Google**.
2. Quên mật khẩu: **Quên mật khẩu?** → làm theo email.
3. Cài lên điện thoại: trang **Cài VN Stock** (`/install`). Android: Chrome →
   Cài VN Stock (hoặc menu → Cài đặt ứng dụng). iPhone: Safari → Chia sẻ → Thêm vào Màn hình chính.
4. Điện thoại có thanh dưới: Tìm mã · Top 10 · Theo dõi · Đầu tư thử · Cài đặt.
   Máy tính: thanh trên cùng, có nút đổi giao diện sáng/tối và mục **Hướng dẫn**.

## 2. Tìm mã, xem chi tiết

- Gõ mã (FPT) hoặc tên công ty vào ô tìm kiếm.
- Trang chi tiết: giá VPS gần nhất, % so với tham chiếu, khối lượng, thời điểm
  nhận (tự làm mới ~10 giây khi tab mở).
- **Biểu đồ & vùng giá**: chỉ tải khi bấm bật.
- Phần BCTC/điểm: năm báo cáo, nguồn, tiêu chí đạt/không đạt/không đủ dữ liệu.
- Tin tức: bài liên quan, có link nguồn gốc. Nút **Theo dõi** để lưu mã.

## 3. Top 10 và Bảng tham khảo

- Chọn kỳ: **Trong ngày** (động lượng, khối lượng, kỹ thuật ngắn hạn, lọc cơ
  bản), **Trong tháng** (kỹ thuật trung hạn, định giá, sự kiện), **Trong quý**
  (Graham, Buffett, biên an toàn). Lọc theo sàn, ngành, vốn hóa; trọng số tin
  tức 0–30% (mặc định 10%).
- **Top 10 chuẩn**: chỉ mã đủ 100% dữ liệu của kỳ và giá có thời điểm phiên được
  xác minh.
- **Bảng tham khảo** (hiện khi Top 10 chuẩn chưa đủ 10 mã): mã đã qua lọc BCTC
  (EPS năm, lợi nhuận, vốn chủ dương; vốn hóa ≥100 tỷ; giá ≥1.000đ), bao phủ
  ≥30%. Điểm chỉ tính trên phần có dữ liệu, **điểm tối đa = % bao phủ**; dòng
  “Còn thiếu” nói rõ dữ liệu chưa có.
- “Tin cậy” là mức hoàn thiện bằng chứng, không phải xác suất tăng giá.

## 4. Điểm Graham / Buffett

- Graham: P/E < 15 và P/B < 1,5 (hoặc tích < 22,5); giá < Graham Number
  √(22,5 × EPS năm × BVPS); thanh toán hiện hành > 2; nợ dài hạn < vốn lưu động;
  lợi nhuận công ty mẹ dương và có cổ tức 3 năm liên tiếp; biên an toàn ≥ 25%.
- Buffett: ROE > 15% ổn định; ROIC > 15%; biên gộp > 20%, biên ròng > 10%; nợ
  vay/vốn chủ < 50%; FCF dương và tăng 3 năm; lợi nhuận tăng bền vững; giá dưới
  DCF với biên an toàn ≥ 25%.
- Chỉ dùng BCTC năm, hợp nhất, đã kiểm toán. Chưa hỗ trợ ngân hàng, chứng
  khoán, bảo hiểm. “Không đủ dữ liệu” không có nghĩa doanh nghiệp xấu.

## 5. Vùng giá & rủi ro (trong trang chi tiết)

Chọn kiểu cắt lỗ (ATR14, đáy gần nhất, phần trăm tối đa), biên an toàn mua; trang
tính vùng mua, chốt lời, cắt lỗ, R:R theo bước giá/biên độ sàn. Kịch bản tham khảo.

## 6. Danh sách theo dõi (`/watchlists`)

Tạo danh sách → thêm mã (từ tìm kiếm, Top 10, trang chi tiết) → có thể ghi giá mua
mục tiêu. Xem giá, điểm hiện tại và lần trước. Chỉ bạn xem được danh sách của mình.

## 7. Cảnh báo (`/alerts`, chuông thông báo)

Chọn mã trong watchlist và loại: chạm vùng mua, chạm mức chốt lời, chạm mức cắt
lỗ, điểm thay đổi lớn, tin quan trọng → **Lưu quy tắc**. Hệ thống kiểm tra ~5
phút/lần. **Gửi cảnh báo thử** để kiểm tra. Email chỉ chạy khi quản trị đã cấu
hình dịch vụ gửi thư.

## 8. Đầu tư thử (`/paper`)

Tạo ví vốn ảo (tối đa 20 ví) → chọn mã → **Lấy giá tham khảo** → nhập số lượng →
mua/bán thử. Phí/thuế là giả định ghi trên form. Không có tiền thật, không gửi
lệnh tới công ty chứng khoán.

## 9. Backtest (`/backtest`)

Lưu mỗi lần Top 10 công bố và tính lợi nhuận giá về sau. Cần đủ thời gian quan
sát; đọc “Quy tắc mô phỏng và giới hạn” trước. “Kiểm tra biến động giá báo cáo”
là công cụ đối chiếu riêng, không phải backtest Top 10.

## 10. Cài đặt (`/settings`)

Trọng số Graham/Buffett (tổng 100%), tăng trưởng, chiết khấu, tăng trưởng dài hạn
(< chiết khấu), số năm DCF; cắt lỗ/trailing 0,5–30%, ATR 0,5–5. Đăng nhập thì lưu
theo tài khoản.

## 11. Trạng thái hệ thống (`/status`)

Xem lần cập nhật thành công của giá, “Dữ liệu cơ bản” (BCTC), điểm/xếp hạng, tin
tức, cảnh báo và nhật ký tác vụ. `degraded` = một phần nguồn lỗi, hệ thống giữ
bản tốt gần nhất và tự thử lại.

## 12. Nguồn dữ liệu

- Giá: VPS (bảng giá công khai), không phải feed chính thức từng lệnh của sàn.
- BCTC năm: KBS + Vietcap; tự làm mới mỗi ngày theo từng lượt nhỏ, kể cả cuối
  tuần. Chi tiết: [financial-sources-2026-10-16.md](financial-sources-2026-10-16.md).
- Vẫn “không đủ dữ liệu” khi: công ty chỉ có BCTC riêng lẻ, BCTC quá 550 ngày,
  nguồn ghi sai kỳ mà không đối chiếu được, hoặc ngành tài chính.

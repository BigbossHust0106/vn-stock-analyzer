# Phần 5 — Vùng mua, TP, cắt lỗ và cảnh báo bán

Trang `/stocks?symbol=DPR` (và các mã khác) sau đăng nhập có vùng tô màu, đường giá và bảng giải thích. Mọi giá là **VND/cổ phiếu**, chỉ mang tính tham khảo, không phải lời khuyên đầu tư. Không phát sinh lệnh mua/bán.

## Dữ liệu và phạm vi

- Dùng lịch sử ngày thực từ VPS và báo cáo tài chính đang có của đúng mã. Không tạo nến hoặc EPS để lấp chỗ thiếu. Giữ nguyên đánh giá chất lượng và điều kiện Top 10 của Phần 4.
- Giá lịch sử hiện có `priceBasis=unverified`, chưa xác minh chốt phiên. Do đó toàn bộ kế hoạch hiện mang nhãn **kịch bản tham khảo**. Lịch sử sai mã, trộn nguồn/basis, trùng ngày, OHLC sai hoặc quá 7 ngày không được dùng tính kỹ thuật. Ngưỡng 7 ngày là lựa chọn của ứng dụng, không thay lịch nghỉ lễ sàn.
- Giá trị nội tại dùng Graham Number từ EPS **năm**, BVPS công ty mẹ và số cổ phiếu so sánh được. Buffett DCF vẫn thiếu bằng chứng dòng tiền: không dùng kịch bản DCF hợp nhất thay thế định giá đã xác minh.
- P/E lịch sử chỉ tính khi có ≥3 giá cuối năm (từ 15/12), giá `unadjusted`, đã chốt, EPS đúng năm và số cổ phiếu không đổi so với hiện tại. Trung vị P/E nhân EPS năm mới nhất. Đây là thống kê hồi cứu, không phải backtest với EPS đã biết vào ngày giao dịch. Nguồn hiện không thỏa điều kiện nên phương pháp này được ghi thiếu dữ liệu.

## Quy tắc mô hình

- Đỉnh/đáy cần 2 nến ở mỗi bên để xác nhận. Hỗ trợ gồm các đáy 120 phiên, đỉnh cũ có 2 nến cuối đóng cửa phía trên (chưa xác nhận retest), MA20/MA50 ngày, Fibonacci retracement nhịp tăng xác nhận gần nhất và nút khối lượng 60 phiên.
- Nút khối lượng: chia khoảng giá thành 12 ô, gán toàn bộ KL ngày theo giá đóng cửa; chọn ô nhiều KL nhất. Đây là proxy, không phải volume profile theo giao dịch hay bằng chứng tổ chức tích lũy.
- Trần mua = Graham Number × (1 − biên an toàn, mặc định 25%). Chọn hỗ trợ cao nhất dưới trần mua và không cao hơn giá hiện tại quá 2%. Nửa bề rộng vùng = max(1 bước giá, min(1% hỗ trợ, 0,25×ATR14)). Làm tròn dưới lên, trên xuống; không tạo vùng nếu khoảng rỗng. Thiếu Graham thì chỉ hiện vùng kỹ thuật và ghi rõ chưa xác nhận biên an toàn.
- Giá vào mặc định là mép trên vùng mua; có thể nhập giá riêng. Giá nhập được làm tròn lên để tính chi phí mua thận trọng, không xác nhận đã khớp.
- SL lựa chọn ATR14 × hệ số (mặc định 2), dưới đáy gần nhất 1 bước hoặc % lỗ tối đa (mặc định 8%). Luôn siết theo % tối đa, làm tròn SL lên; mức không thấp hơn giá vào sẽ bị loại.
- TP: tập ứng viên Graham, đỉnh cũ, Fibonacci extension 1,272/1,618/2,618 và P/E lịch sử riêng mã nếu đủ. Làm tròn xuống, kiểm tra `(TP−entry)/(entry−SL)≥2`, loại trùng, chọn 3 mức tăng dần. Không tự nâng mục tiêu để đủ R:R. Thiếu mức nào ghi lý do ở mức đó.
- Trailing cần giá vào và ngày vào không thuộc tương lai. Lấy high các ngày **sau** ngày vào (không biết giờ khớp nên bỏ high của ngày vào), cùng high đã lưu. Stop = max(high × (1−trailing%), stop đã lưu, SL gốc), làm tròn lên và không giảm. Đổi ngày/giá vào hoặc khôi phục mặc định sẽ xóa trạng thái vị thế cũ.
- Cảnh báo: giá >1,2×Graham; phân kỳ giảm high cao hơn nhưng RSI14 giảm >3 điểm hoặc đường MACD12/26/9 thấp hơn tại hai đỉnh xác nhận cách ≥5 phiên, trong 90 phiên gần nhất; KL trung bình 5 phiên <40% trung bình 20 phiên trước đó. Không đủ chuỗi hiện “Không đủ dữ liệu”, không kết luận không có cảnh báo.
- Các ngưỡng trên là lựa chọn mô hình của ứng dụng. R:R chưa gồm thuế, phí và trượt giá. Stop có thể không thực hiện được khi giảm sàn hoặc thiếu thanh khoản.

## Bước giá và biên độ

Cổ phiếu HOSE: dưới 10.000 bước 10đ; từ 10.000 đến dưới 50.000 bước 50đ; từ 50.000 bước 100đ. HNX/UPCOM bước 100đ. Phiên thông thường ±7% / ±10% / ±15%; ưu tiên trần/sàn quote có sẵn, nếu thiếu mới ước tính từ tham chiếu (sàn làm tròn lên, trần làm tròn xuống). Không áp dụng ước tính thông thường cho ngày đầu/sự kiện đặc biệt; cần quote đúng phiên.

Vùng nhiều phiên không bị cắt về biên độ hôm nay. Bảng ghi “Trên trần phiên”/“Dưới sàn phiên”: chưa thể đặt tại mức đó trong phiên hiện tại. Timestamp phiên của quote vẫn chưa được nguồn xác minh.

Tài liệu tham chiếu sàn:

- [HOSE, Quy định cần biết T2/2026](https://staticfile.hsx.vn/Uploads/UploadDocuments/2453338/HTGD_Quy%20dinh%20can%20biet%20khi%20GDCK%20tren%20HOSE_T2.2026.pdf) — truy cập tự động trả HTTP 503 trong lần triển khai này; chưa đối chiếu được toàn văn mới nhất.
- [HNX, quy định tham chiếu và biên độ cổ phiếu chuyển từ HOSE](https://hnx.vn/vi-vn/m-tin-tuc-hnx/Quy%20dinh%20ve%20gia%20tham%20chieu%20va%20bien%20do%20giao%20dich%20doi%20voi%20co%20phieu%20chuyen%20giao%20dich%20tu%20HOSE%20sang%20HNX-60011411-0.html) — nguồn tham chiếu bước 100đ và biên độ thông thường 10%; không suy rộng biên độ phiên đặc biệt.

## Lưu cài đặt và kiểm thử

Cài đặt vùng giá và trạng thái trailing lưu **trong trình duyệt**, tách theo user ID và mã (`vn-stock-trade-plan-v1:<user>:<symbol>`), không đồng bộ thiết bị; không ghi thêm dữ liệu cá nhân vào Supabase. Trailing cập nhật khi trang tải dữ liệu, không phải dịch vụ giám sát vị thế chạy nền. Watchlist và RLS vẫn giữ cơ chế Phần 4.

- `npm run verify`: toàn bộ kiểm tra bắt buộc, gồm unit test ATR, RSI, MACD, Fibonacci có đáp án tính tay và các tình huống vùng giá, bước giá, cap lỗ, trailing, dữ liệu thiếu.
- `npm run verify:trade-plan:browser`: tài khoản tạm, dữ liệu DPR thực; bảng/biểu đồ, R:R, bước giá, đổi cài đặt, tải lại, trailing, màn hình 390px và lỗi JavaScript. Tài khoản kiểm thử luôn được xóa sau chạy.
- `MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:trade-plan:browser`: kiểm tra bản phát hành thực.

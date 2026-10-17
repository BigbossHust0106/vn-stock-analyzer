# Xuất dữ liệu để kiểm chứng với ChatGPT / Claude

Tại trang mã, chọn **Kiểm chứng bằng ChatGPT** hoặc **Kiểm chứng bằng Claude**.
Xem trước gói dữ liệu, chọn **Sao chép & mở**, rồi dán vào AI. Nếu gói dài,
chọn **Tải file .txt** và đính kèm. Không giả định AI đã nhận dữ liệu hoặc đã
xác minh chỉ vì mở được tab. Chức năng không gọi API trả phí của hai dịch vụ.

Gói giữ toàn bộ trường công khai API trả về: tổng quan/quote/giá dự phòng,
OHLCV lịch sử hiện khả dụng, BCTC tất cả năm đã tải, bằng chứng tài liệu,
trạng thái nguồn dự phòng, tin trực tiếp/bối cảnh kèm nguồn, điểm mặc định
server; kèm điểm tính với tham số người dùng hiện tại và MA20/50/200,
RSI14/ATR14/MACD12-26-9. Không làm tròn số, không bỏ null, giữ timestamp,
đơn vị raw và mức xác minh. Không có báo cáo gốc đầy đủ trong API thì không
nói đã xuất báo cáo gốc. Không tải thêm chart lúc mở trang; chỉ thu thập khi
bấm nút xuất. Các nhóm có thể được tải ở thời điểm khác nhau, không phải
snapshot transaction thị trường. Mỗi nhóm giữ thời điểm nguồn của chính nó.

Gói không chứa token, thông tin tài khoản, ghi chú, watchlist hoặc vị thế.
Các trọng số/giả định chấm điểm hiện hành có trong gói để kiểm tra tính toán.
URL đích cố định: `https://chatgpt.com/`, `https://claude.ai/new`; dữ liệu không
được đưa vào URL. Clipboard có thể bị chặn trên một số browser/PWA; ô văn bản,
file tải xuống và link mở AI là phương án dự phòng. Bạn quyết định dán/gửi
nội dung ra nhà cung cấp. Giới hạn đính kèm/context tùy tài khoản AI.

Prompt yêu cầu dẫn nguồn độc lập và ghi rõ nếu không có khả năng duyệt web;
không coi fetchedAt là timestamp sàn, không coi DCF proxy là giá trị đã xác
minh. Nội dung tin tức/nguồn được đánh dấu là dữ liệu, không phải chỉ dẫn.
Kết quả AI vẫn cần đối chiếu báo cáo gốc, chỉ mang tính tham khảo.

Kiểm tra: `npm run verify`; `npm run verify:export:browser` (Chromium và Auth
Supabase thật; tạo/xóa tài khoản thử). Browser test kiểm tra gói dữ liệu và
link đích, không tự gửi vào ChatGPT/Claude hoặc xác minh kết quả AI bên ngoài.

## Kết quả kiểm tra 16/10/2026

- `npm run verify`:9/9 PASS,214 unit PASS,55 provider PASS và1 TODO cũ về lastVolume.
- Browser390/1440px dùng Auth và API công khai FPT thật: không tải lịch sử sớm,
  gói chứa BCTC/lịch sử/MA, clipboard và file giữ đúng toàn bộ nội dung, link
  đích cố định không chứa dữ liệu, clipboard bị chặn có phương án thay thế;
  không có lỗi JavaScript. Clipboard/window.open được chặn bằng test harness
  để kiểm tra nội dung/URL; không tự đăng nhập hoặc gửi dữ liệu vào AI bên ngoài.
- [Log verify nguyên văn](verify-stock-export-2026-10-16.txt).
- [Log browser](browser-stock-export-2026-10-16.txt).

## Đánh giá và phân tích của chính website

Bản xuất v2 thêm khối đọc được **ĐÁNH GIÁ WEBSITE**: kết luận, điểm tổng,
điểm Graham/Buffett, trọng số, độ phủ dữ liệu, mức tin cậy, từng tiêu chí và
lý do đạt/không đạt/thiếu, giá trị nội tại, biên an toàn, kịch bản proxy và rủi ro.
`websiteAssessment.report` giữ báo cáo thực sự đang hiển thị trên trang tại lúc
bấm xuất, gồm thời điểm và đầu vào; tách riêng `scoringAtExport` là bản tính lại
với dữ liệu tải lúc xuất. Nếu phần đánh giá chưa tải xong thì ghi rõ chưa có,
không gán bản tính lại thành nội dung đã hiển thị. Phân tích ảnh hưởng tin tức
và lập luận/nhãn của từng bài giữ trong `news.score` và `articles[].analysis`.

Prompt yêu cầu AI phản biện cả suy luận/kết luận của website, không chỉ đối
chiếu số: chỉ ra tiêu chí chấm sai, lập luận thiếu bằng chứng, giả định quá mức
và kết luận cần sửa. Không thay đổi công thức hay điểm của website trong tính
năng xuất này; không coi confidence là xác suất sinh lời.

Kiểm tra bổ sung17/10/2026:216 unit PASS; browser Auth/API FPT thật xác nhận
điểm/kết luận xuất khớp nội dung đang hiển thị, tất cả giải thích từng tiêu chí
và rủi ro có trong gói. [Log browser](browser-export-assessment-2026-10-17.txt),
[log verify nguyên văn](verify-export-assessment-2026-10-17.txt).

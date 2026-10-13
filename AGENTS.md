# AGENTS.md: Quy tắc làm việc cho dự án đánh giá cổ phiếu Việt Nam

## Bối cảnh
Ứng dụng web đánh giá và sàng lọc cổ phiếu theo triết lý Benjamin Graham và
Warren Buffett.
- Thị trường: CHỈ Việt Nam (HOSE, HNX, UPCOM).
- Dữ liệu giá: API của VPS Securities, bọc trong `VpsProvider` thực thi
  interface `DataProvider`. Không tự bịa endpoint hay cấu trúc dữ liệu; nếu
  chưa chắc thì kiểm tra thực tế hoặc hỏi người dùng. Có cache, retry, xử lý
  giới hạn gọi.
- Công nghệ: Next.js + TypeScript + Tailwind; Cloudflare Pages/Workers
  (Cron Triggers); Supabase (PostgreSQL, Auth, RLS); GitHub Actions.
- Bảo mật: API key chỉ nằm trong secrets/biến môi trường, không hard-code.
  Có .env.example.
- Giao diện, thông báo, giải thích bằng tiếng Việt; số liệu theo chuẩn Việt
  Nam; luôn có cảnh báo "chỉ mang tính tham khảo, không phải lời khuyên đầu tư".
- Cấu trúc module: providers / strategies / scoring / news / api / ui.

## Cách làm việc
- Người dùng giao từng Phần. Chỉ làm đúng Phần được giao, không làm trước
  phần sau.
- Nếu có lựa chọn quan trọng: nêu phương án đề xuất kèm ưu nhược điểm rồi
  tiếp tục theo phương án đó.
- Sau khi hoàn tất thay đổi được giao và `npm run verify` PASS, tự động commit
  và push lên GitHub, mặc định nhánh `main`, không hỏi lại xác nhận. Quyền này
  áp dụng cho các phiên làm việc sau, trừ khi người dùng yêu cầu khác.
- Chỉ commit thay đổi thuộc nhiệm vụ; giữ nguyên thay đổi riêng của người dùng.
  Không force-push. Nếu kiểm tra hoặc push bị lỗi, xử lý lỗi trong phạm vi được
  giao và báo rõ phần còn bị chặn; không tuyên bố đã upload khi chưa push thành công.

## Quy tắc kiểm tra bắt buộc
- Mọi thay đổi phải qua `npm run verify` (typecheck, lint, format, test,
  build, kiểm tra migration, kiểm tra RLS). Không được báo hoàn thành khi
  còn bước đỏ.
- Công thức tài chính (Graham Number, biên an toàn, DCF, ATR, RSI, MACD,
  Fibonacci) phải có unit test với đáp án tính tay ghi trong comment. Cấm
  sửa đáp án trong test cho khớp code; nếu lệch thì sửa code.
- Hàm tài chính gặp dữ liệu thiếu/EPS âm/chia 0 phải trả về "không đủ dữ
  liệu", không được ra NaN hay Infinity.
- Luôn kiểm tra riêng ba lỗi hay gặp: nhầm đơn vị (nghìn đồng/đồng,
  triệu/tỷ), nhầm EPS quý với EPS năm, giá điều chỉnh với giá chưa điều
  chỉnh khi chia cổ tức/thưởng cổ phiếu.
- Chưa xác minh được điều gì thì ghi rõ là "giả định", không được nói
  "đã kiểm tra".

## Báo cáo khi bàn giao (theo đúng mẫu)
1. ĐÃ XÁC MINH BẰNG MÁY: (lệnh đã chạy + kết quả nguyên văn)
2. CHƯA XÁC MINH / GIẢ ĐỊNH:
3. LỖI TỰ TÌM THẤY VÀ ĐÃ SỬA: (sau khi tự review lại như một reviewer khó tính)
4. RỦI RO CÒN LẠI:
5. CÁCH TÔI TỰ KIỂM TRA: (các bước cụ thể)

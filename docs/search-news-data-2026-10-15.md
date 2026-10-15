# Tìm mã trên header, tin gọn và ưu tiên dữ liệu

## Hành vi mới

- Ô tìm mã/tên công ty nằm ngay trên thanh điều hướng của mọi trang đã đăng nhập. Gõ không chuyển trang; gợi ý và Enter mở chi tiết mã. Escape/bấm bên ngoài đóng gợi ý. Trang chủ không còn yêu cầu sang trang tìm kiếm riêng.
- Trang chủ hiển thị các mã có nhiều dữ liệu. RPC công khai tính trung bình coverage của cả Graham và Buffett từ điểm có cùng phiên bản BCTC, rồi ưu tiên kỳ mới và số năm. Kết quả tìm vẫn giữ mã khớp chính xác trước. Giữ cả hai chiến lược, không tự đổi trọng số người dùng.
- Danh sách chưa đủ điều kiện ở Top10 cũng ưu tiên coverage; các mã đó vẫn không có thứ hạng đầu tư. Không nới điều kiện Top10 đầy đủ100% để lấp dòng.
- Tin mặc định chỉ lấy bài nhắc trực tiếp mã. Năm nhóm yếu tố ảnh hưởng chỉ hiện tối đa một tin trực tiếp/nhóm, không đưa tin mã khác thành tác động riêng. Bài chi tiết nằm sau “Xem thêm tin và chi tiết”; tóm tắt/bằng chứng cũng mở theo yêu cầu.
- Bối cảnh ngành/thị trường phải chọn riêng trong phần mở rộng; API chỉ truy vấn kho tin tổng quát khi `scope=context`. Các bài bối cảnh có nhãn riêng, không được dùng cảm xúc chung để chấm từng mã.

## Dữ liệu tài chính

[Khảo sát nguồn và dự phòng](financial-sources-2026-10-15.md) ghi rõ endpoint, đơn vị chưa xác minh, quota chưa biết và nguồn trả lỗi. Đã đồng bộ thật DPR/FPT/HPG/VNM: KBS bốn kỳ2022–2025 và kho Vietcap ba loại báo cáo. Kho raw có RLS đọc công khai/ghi service-only; từ chối bản rỗng, mất trường hoặc lùi dữ liệu. Nguồn lỗi giữ bản tốt.

Không đưa số raw Vietcap chưa xác minh vào BCTC hợp nhất kiểm toán. Nguồn dự phòng hiện giúp lưu và đối chiếu báo cáo; chưa phải thay nóng toàn bộ đầu vào chấm điểm. Owner Earnings, dòng tiền công ty mẹ, cơ sở điều chỉnh giá và cổ phiếu vẫn phải có bằng chứng; thêm endpoint không tự giải quyết các thiếu hụt đó.

## Đã kiểm chứng

- `npm run verify`: 9/9 PASS, 149 unit PASS, 40 provider PASS và 1 TODO cũ; coverage toàn bộ file được đo99,35% lines; 14 migration/RLS PASS. `npm run smoke`: web/Worker/API input PASS. Output nguyên văn tại [verify-search-news-data-2026-10-15.txt](verify-search-news-data-2026-10-15.txt).
- PostgreSQL: migration, RLS; bài toán độc lập coverage(.8+.6)/2=.7 trước(.2+.4)/2=.3; mã khớp chính xác/sàn/escape; kho backup không cho anon ghi, lỗi nguồn không xóa số tốt.
- Unit/API: mặc định tin chỉ có mã đích, bài mới của mã khác bị loại; bối cảnh cần opt-in; mặc định không đọc kho tin chung; danh sách coverage.8 trước.2 nhưng không tự vào Top10. Adapter dùng chính fixture Vietcap thật, annual EPS raw4028 không nhân1000, không tự gán kiểm toán, dữ liệu raw bị validator chấm điểm từ chối.
- Browser: Auth thật bằng tài khoản thử được xóa sau chạy; market/news fixture để kiểm tra điều khiển có thể tái lập. Tìm từ Cài đặt mà chưa chuyển trang, gợi ý/Escape/Enter, tin đóng/mở và opt-in bối cảnh, badges cả hai chiến lược, năm trang390/768px không tràn ngang/không lỗi JS.
- Browser với dữ liệu Supabase/provider thật: VNM/FPT/HPG có giá/canvas, MA20/50/200 và volume tính độc lập; EPS/Graham/scenarioDCF/MOS giữ assertion cũ, cài đặt100/0 được lưu và khôi phục. [Output](browser-search-news-data-2026-10-15.txt).
- API tin theo mã với Supabase thật: VNM2/FPT6/HPG2/DPR0 tin trực tiếp, cả bốn HTTP200 và không có bài ngoài mã trong chế độ mặc định. DPR0 tin được hiển thị thiếu, không chèn tin chung.
- Supabase RPC thật qua publishable key: DPR coverage95%(Graham100/Buffett90), DCM và VNM90%, cả bốn kỳ năm2022–2025. Đây là độ đầy đủ tiêu chí, không phải kết luận mua hoặc chứng nhận kiểm toán100%.

## Lỗi tự review và đã sửa

- Truy vấn tin bối cảnh150 bài vẫn chạy dù mặc định chỉ xem mã: chỉ gọi khi opt-in.
- Header mobile không tràn nhưng ô tìm quá hẹp: chuyển thành hàng đủ chiều ngang, xem lại screenshot thay vì chỉ dựa vào assertion overflow.
- Mock financial API chưa biết request trạng thái backup mới: bổ sung đúng response cho endpoint và kiểm tra vẫn không gọi provider ngoài ý muốn; không sửa đáp án tài chính.
- Test thiếu mã kiểm tra Promise rejection trong khi validator ném lỗi đồng bộ: dùng assertion synchronous, giữ nguyên yêu cầu từ chối mã sai.

## Phần chưa xác minh / rủi ro

- Một số mã chưa có tin trực tiếp trong RSS7 ngày; không dùng bài lan man để lấp chỗ trống.
- Metadata/định nghĩa còn thiếu vẫn hiển thị thiếu; raw backup không làm giả coverage100%.
- Các API web không chính thức có thể đổi hoặc bị chặn. TCBS ba endpoint tài chính cũ trả404; SSI/FiinGroup cần quyền/contract trước khi tích hợp.
- TODO đơn vị lastVolume cũ vẫn chưa đủ đối chiếu. Không thay công thức tài chính, kiểm tra corporate actions hoặc kết luận xác minh timestamp sàn.

## Cách tự kiểm tra

1. Mở Cài đặt hoặc Watchlist, gõ VNM/FPT/HPG ở header, chọn gợi ý hoặc Enter; không cần trở về trang chủ.
2. Mở mã; phần tin dừng ở các yếu tố ảnh hưởng. Bấm “Xem thêm tin và chi tiết”, thử nút Trực tiếp mã/Bối cảnh; xem nhãn bối cảnh tách riêng.
3. Trang chủ xem coverage riêng của Graham và Buffett; mở “Nguồn BCTC chính và dự phòng” tại chi tiết mã.
4. `npm ci && npm run verify`; browser riêng `npm run verify:focus:browser` cần server local/build cùng URL API và Playwright có CA mạng, quyền tạo user thử Supabase.
5. Nguồn thật: `npm run verify:financial-backups:live`; chỉ in các kỳ raw, không quảng bá đó là số đã kiểm toán.

# Mở rộng danh mục và độ phủ BCTC — 22/10/2026

## Nguyên nhân đã xác minh

- Public DB có1.522 mã nhưng ban đầu chỉ32 snapshot có số liệu năm.
- `refreshStaleFinancials` lọc theo `SYNC_SYMBOLS || rankingUniverse`:35 mã
  cố định. Cron cũ chỉ xoay vòng/làm mới nhóm đó, không khám phá phần còn lại.
- `search_stocks_by_coverage` giới hạn20 kết quả cho autocomplete; trang chủ
  lại `.slice(0,12)` và không có phân trang. Không thể dùng nó làm danh mục đầy đủ.
- Đồng bộ danh mục từng phụ thuộc nhánh cuối phiên có lịch giao dịch hợp lệ.
  Chưa có bằng chứng được phép tự tạo lịch phiên để vượt điều kiện này.

## Sửa

- `/v1/catalog` đọc public với phân trang24 mã, tổng số kết quả chính xác,
  lọc mã/tên/sàn/có BCTC/chưa có snapshot. Không dùng service_role cho API này.
  Số đếm tách1.522 mã danh mục, snapshot có kỳ năm, chưa có snapshot và nhóm
  còn lại. Danh sách theo mã; độ phủ cả Graham/Buffett dùng engine hiện có,
  không phải khuyến nghị mua hay bảng Top10. Không đổi công thức/chấm điểm.
- Trang chủ có tìm kiếm, bộ lọc và trang trước/sau; không cắt ở12/20 mã.
  Mặc định hiện mã có BCTC năm; “Toàn bộ mã” hiện toàn danh mục. Tự kiểm tra
  lại mỗi phút khi mở trang; nguồn lỗi không bị biến thành kết quả rỗng thành công.
- Hàng BCTC đọc toàn bộ mã active và thời điểm snapshot theo trang500, vượt
  giới hạn1.000 của PostgREST; lỗi bất kỳ trang nào dừng đọc. Không còn giới
  hạn35 mã trong hàng làm mới tự động. Nguồn rỗng/lỗi không ghi đè snapshot tốt.
- Thay maintenance trigger5 phút bằng trigger mỗi phút, không thêm số trigger.
  Mỗi lượt tối đa1 mã BCTC; alerts/email/probe VPS vẫn mỗi5 phút. Xoay vòng
  theo phút để mã lỗi không cố định ở đầu hàng. Không hứa tất cả mã có dữ liệu
  hợp lệ hay thời gian hoàn thành cứng: còn phụ thuộc nguồn, retry, lịch cache
  và ngân sách Worker. Mở một mã vẫn có thể yêu cầu tải BCTC theo nhu cầu.
  -07:02 giờ Việt Nam mỗi ngày (kể cả ngày nghỉ): tải/đối soát catalog riêng,
  không đòi phiên giao dịch. Lượt bảo trì5 phút cũng đối soát ngay nếu catalog đã cũ hơn23 giờ, để không phải chờ ngày hôm sau sau khi triển khai. RPC hiện có vẫn từ chối thiếu sàn, trùng mã,
  catalog tụt bất thường hoặc timestamp cũ; không xóa/vô hiệu hóa hàng loạt
  khi nguồn lỗi. Cache catalog KBS1 giờ để không lặp lại bản cache ngày trước.
- Không sửa kiểm tra lịch phiên, timestamp sàn, finality, RLS, Top10 hoặc
  giả định ngân hàng/công ty chứng khoán phù hợp công thức doanh nghiệp thường.

## Tải bổ sung thực tế

Hai đợt gọi API BCTC hiện có, tối đa2 request đồng thời, cách lượt khởi tạo
ít nhất3,1 giây; đọc lại DB để xác nhận ghi thành công. Từ32 lên84 snapshot
có kỳ năm. Có thêm GAS, FRT, DGW, BWE, DBC, HAH, PLX, PVS, ACV và nhiều mã khác.
Một số mã trả rỗng/lỗi; không giả lập hay coi chúng là đã đủ dữ liệu.
[Đợt1](catalog-backfill-batch1-2026-10-22.txt),
[đợt2](catalog-backfill-batch2-2026-10-22.txt).

## Kiểm tra và giới hạn

- Unit kiểm tra đọc vượt1.000 mã, trang DB sau lỗi thì dừng, bộ lọc/offset/
  số đếm, không dùng service key cho catalog, cron phút ngoài phiên/cuối tuần
  và lịch catalog độc lập phiên. Công thức không đổi.
- Live đọc public DB thật: đủ1.522 mã/hàng BCTC,64 trang, trang2/64 không trùng
  hay mất trang, lọc3 sàn, FRT ngoài universe cũ có BCTC. Không suy ra có giá
  realtime/lịch sử/BCTC đầy đủ cho tất cả1.522 mã chỉ từ số lượng catalog.
- Token quản trị Supabase và Cloudflare trong environment trả HTTP401 ở đợt
  này. Không cần migration mới hoặc sửa secret sản xuất; deploy qua GitHub
  integration hiện có. Browser dùng Auth fixture riêng để vào UI; API catalog
  và DB công khai thật. Không dùng browser này để tuyên bố Auth/RLS production
  đã được xác minh. Verify vẫn kiểm tra RLS bằng Postgres local với2 user.
- Các script bulk/nhánh giá tham khảo dùng `rankingUniverse` trước đây không
  trở thành cam kết cập nhật realtime toàn thị trường. Việc mở rộng ở đây là
  danh mục và hàng BCTC tự động; xem thời điểm cụ thể ở từng mã.

## Kết quả máy trước triển khai

- `npm run verify`:9/9 PASS;232 unit PASS,55 provider PASS và1 TODO cũ về lastVolume.
  [Log nguyên văn](verify-catalog-expansion-2026-10-22.txt).
- [Live public DB](catalog-live-2026-10-22.txt):1.522 mã,84 mã có BCTC năm,
  64 trang; hàng đồng bộ đọc đủ1.522 mã.
- [Browser](browser-catalog-2026-10-22.txt):24 thẻ/trang và trang2 khác trang1,
  lọc toàn bộ/HNX, tìm FRT,390/1440px, không lỗi JavaScript; Auth là fixture.

Đối chiếu endpoint KBS thực tế22/10:nguồn hiện trả1.519 mã (HOSE406,HNX299,
UPCOM814), so với1.522 mã active đã lưu trước triển khai. Đối soát bảo vệ sẽ
cập nhật chênh lệch3 mã này theo dữ liệu nguồn; bộ đếm giao diện không hard-code
1.522. Đây là danh mục nguồn KBS đã kết nối, chưa phải xác nhận độc lập toàn
bộ danh sách niêm yết chính thức của ba sàn.

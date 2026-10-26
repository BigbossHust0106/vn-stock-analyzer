# Giới hạn tải đọc/ghi Supabase — 26/10/2026

## Những nguồn khuếch đại tải đã thấy trong code

- Cron BCTC mỗi phút liệt kê toàn bộ stocks và financial_snapshots để chọn1 mã.
- GET BCTC đang dùng bản lưu vẫn gọi RPC lưu lại snapshot, fundamentals và điểm.
- Tải lại lịch sử ghi lại toàn bộ chuỗi chỉ vì fetchedAt mới hơn, dù OHLCV giống hệt.
- RSS mỗi30 phút ghi news_scores cho toàn danh mục, gồm cả mã không có tin riêng;
  hàng LLM chưa cấu hình cũng có thể upsert lại các bài pending không thay đổi.
- Ranking rộng tính/ghi lại mỗi5 phút trong giờ quan sát, cộng các lượt tin tức
  cả ngoài phiên. Cleanup log lại chạy ở nhánh cron tần suất cao.
- Catalog chưa vào allowlist edge cache, và mỗi trang/từ khóa lại đếm3 bảng;
  rankings/summary không có cache edge dùng chung.

Đây là đường đọc/ghi xác minh bằng code và test, chưa phải kết luận định lượng
rằng từng đường chiếm bao nhiêu phần trăm Disk IO thực tế. Cần pg_stat_statements
và metrics Supabase để xác nhận trên production.

## Chính sách mới (có test ngân sách, không đổi công thức)

| Hạng mục       | Giới hạn                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BCTC nền       | 1 lượt/5 phút;1 mã/lượt;2 truy vấn metadata nhỏ trong trường hợp catalog đã có state; không quét danh mục                                              |
| BCTC còn mới   | Cache7 ngày; lượt nền bỏ qua nguồn, backup và mọi write; vòng duyệt vẫn bao gồm toàn bộ catalog KBS, không quay lại cap35 mã                           |
| Công bằng      | Vị trí modulo theo slot5 phút và tổng catalog; lỗi một mã không giữ nó ở đầu hàng. Thời gian quay hết vòng phụ thuộc quy mô, nguồn và metadata catalog |
| GET BCTC       | Chỉ lưu khi thực sự tải được snapshot mới hợp lệ; đọc cache không ghi lại điểm/BCTC                                                                    |
| Lịch sử        | Chỉ gửi nến mới hoặc OHLCV/volume thay đổi, không coi fetchedAt là thay đổi dữ liệu                                                                    |
| Ranking rộng   | Tối đa2 lần/giờ quan sát, cộng các lượt cuối phiên đã có; không republish sau mỗi heartbeat RSS ngoài giờ                                              |
| Tin tức        | Thu thập theo giờ; chỉ ghi news_scores cho mã có bài riêng; không ghi1.500 hàng rỗng; không viết lại pending khi LLM chưa được gọi                     |
| Cache edge     | Catalog120s; BCTC300s; ranking60s; summary5s; lịch sử300s; request trùng được gom vào1 lượt backend                                                    |
| Riêng tư       | Không cache Auth, watchlist, cảnh báo, agent, tài khoản; có Authorization/Cookie hoặc refresh=1 thì bypass; lỗi không cache                            |
| Bộ đếm catalog | Cache chung tối đa5 phút, có countsAsOf hiển thị, không giả thời điểm đọc mới                                                                          |
| Tác vụ phụ     | Email chưa cấu hình không tạo job log lặp; probe VPS15 phút; retention job log1 lần/ngày                                                               |

Giá thay đổi vẫn cập nhật qua đường quote riêng; nhịp polling đang xem không
bị đổi thành nhịp BCTC. Cache giữ timestamp gốc, không biến thời điểm trả cache
thành timestamp sàn. Mã chưa có dữ liệu vẫn có thể được tải khi người dùng mở mã.
Giới hạn7 ngày là tuổi tối thiểu để đưa BCTC đã có vào lượt làm mới, không phải
cam kết tất cả mã được kiểm tra đúng mỗi7 ngày; vòng catalog lớn có thể dài hơn.

## Migration SQL bổ sung

`supabase/migrations/20261026090000_disk_io_budget.sql`:

- Index cho tra cứu coverage theo financial_version, freshness scores/news,
  chọn mã active và dọn log theo ngày.
- Trigger history/fundamentals bỏ qua UPDATE chỉ đổi fetched_at, giữ heap tuple.
- Quote giống hệt trong60s không tạo phiên bản tuple/quote version mới; thay
  đổi giá hoặc khối lượng vẫn ghi ngay; sau60s giữ heartbeat quan sát.
- Không thay RLS, grants, công thức, nguồn, finality hay CAS đầu vào chấm điểm.
- lock_timeout3s và statement_timeout60s; không VACUUM FULL, không xóa dữ liệu
  tài chính/lịch sử/người dùng để cố giải quyết cảnh báo.

Migration không phải điều kiện để Worker mới chạy: guard/cache/delta trong code
đã giảm các request và write dư. Trigger SQL còn bảo vệ các caller bulk/cũ.
Không được coi migration đã áp dụng production chỉ vì CI/local đã PASS.

## Kiểm tra đã chạy

`npm run verify`:245 unit PASS;55 provider PASS và1 TODO cũ về lastVolume;
22 migration và RLS local PASS. [Output nguyên văn](verify-io-budget-2026-10-26.txt).

Test ngân sách gồm200.000 mã vẫn chỉ2 record metadata trả về/lượt; vòng1.519
mã không cắt ở1.000; lượt BCTC mới không đọc/ghi thêm;8 request đồng thời chỉ1
backend load; query/trang khác không đếm lại3 bảng;2.000 mã và1 bài issuer chỉ
viết1 news_score; stale callbacks dừng trước DB; chỉ2 ranking/h thay vì12.
Test SQL dùng ctid/version chứng minh bản trùng không tạo heap version mới,
nhưng sửa OHLCV/EPS và thay đổi quote thực vẫn được lưu; anon vẫn không được ghi.
Không đổi đáp án tính tay của bất kỳ công thức tài chính nào.

## Vận hành và theo dõi

- Cờ Worker `PAUSE_BULK_SYNC=true` (Text) tạm dừng BCTC/news/ranking/catalog bulk;
  giữ đường quote và bảo trì cảnh báo. Dùng khi IO đang cạn; dữ liệu đã lưu còn
  hiển thị với timestamp gốc. Đặt lại `false` để tiếp tục vòng nền.
- Theo dõi Disk IO/IOPS, CPU iowait, latency, shared_blks_read/written và update
  của scores/news_scores/prices_history trong24 giờ sau deploy. Tests chỉ chứng
  minh giới hạn thao tác, không đo mức giảm Disk IO production hay hứa không
  bao giờ vượt compute hiện có.
- Trước apply SQL: giảm tải Worker trước, chọn lúc ít truy cập. Migration có
  lock/statement timeout; lỗi phải rollback và điều tra, không tăng timeout mù.
- Quyền Supabase Management trong environment vẫn HTTP401 sau khi người dùng
  báo cập nhật. Cần PAT hợp lệ được áp dụng cho môi trường để kiểm tra query
  stats/apply migration. Không đưa PAT vào code, browser hoặc log; không nâng
  compute/gói dịch vụ trong nhiệm vụ này.

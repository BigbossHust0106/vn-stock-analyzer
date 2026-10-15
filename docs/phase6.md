# Phần 6 — Tin tức và yếu tố ảnh hưởng

Trang chi tiết mã sau đăng nhập có tin RSS, nguồn, thời gian, cảm xúc, mức ảnh hưởng và thời hạn; bảng bối cảnh gồm vĩ mô, ngành, sự kiện doanh nghiệp, khối ngoại và thanh khoản. Mọi nhãn là kết quả mô hình, không phải lời khuyên đầu tư.

## Nguồn và điều kiện sử dụng

Kiểm tra thực tế ngày 15/10/2026 (giờ Việt Nam): cả bốn `robots.txt`, trang RSS và các feed đã khai báo đều trả dữ liệu. Robots cho phép đường dẫn RSS với user-agent của ứng dụng; robots không phải giấy phép bản quyền. Chỉ lấy tiêu đề, mô tả RSS tối đa 700 ký tự và link gốc; không lấy toàn văn, hình ảnh hoặc vượt paywall. Cache tin 30 ngày, cửa sổ tính điểm 7 ngày. Khi nguồn yêu cầu dừng hoặc điều kiện thay đổi, phải tắt nguồn và rà soát quyền sử dụng.

| Nguồn     | RSS / điều kiện đã đọc                                                                                                                                   | Phạm vi và lưu ý                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CafeF     | [RSS](https://cafef.vn/rss.chn), [robots](https://cafef.vn/robots.txt)                                                                                   | Trang RSS mô tả tiêu đề, tóm tắt, link và lịch lấy tự động qua RSS Reader. Không suy ra quyền tái bản toàn văn/thương mại.                                              |
| Vietstock | [RSS](https://vietstock.vn/rss), [robots](https://vietstock.vn/robots.txt)                                                                               | Có danh mục RSS công khai; chân trang giữ bản quyền Vietstock. Chưa tìm thấy giấy phép thương mại rộng hơn trên trang này. Chỉ dùng metadata RSS có dẫn nguồn.          |
| VnEconomy | [RSS và điều khoản](https://vneconomy.vn/rss.html), [robots](https://vneconomy.vn/robots.txt)                                                            | Nguồn miễn phí cho cá nhân/tổ chức phi lợi nhuận; yêu cầu ghi nguồn và có thể yêu cầu dừng. Footer yêu cầu văn bản khi đăng lại tin bài; ứng dụng chỉ đọc metadata RSS. |
| VnExpress | [RSS và điều khoản](https://vnexpress.net/rss), [điều khoản chung](https://vnexpress.net/dieu-khoan-su-dung), [robots](https://vnexpress.net/robots.txt) | RSS miễn phí cho cá nhân/tổ chức phi lợi nhuận, ghi nguồn, có thể yêu cầu dừng. Không suy ra quyền thương mại.                                                          |

Người dùng đã xác nhận **cá nhân, phi lợi nhuận** trong phiên triển khai này. `NEWS_RSS_PERMISSION=personal-nonprofit` bật hai nguồn hạn chế; không có giá trị này thì chúng ở trạng thái `policy_blocked`. Chỉ đặt `licensed` khi có quyền sử dụng phù hợp. Tài liệu này ghi nhận điều khoản đã đọc, không phải ý kiến pháp lý về giấy phép.

Feed cụ thể nằm trong `modules/news/sources.ts`: chứng khoán, doanh nghiệp, vĩ mô, ngân hàng và hàng hóa. Sáu chủ đề vĩ mô: lãi suất, tỷ giá, CPI/lạm phát, chính sách NHNN, dầu và vàng. Mỗi lượt Cron tải robots trước; lỗi, HTML giả robots hoặc đường dẫn bị cấm thì không truy cập feed tương ứng. Không theo redirect ngoài URL nguồn đã kiểm tra.

## Thu thập và dữ liệu

- Cron `*/30 * * * *`: mỗi 30 phút, cả cuối tuần; lịch Cloudflare dùng UTC nhưng giao diện dùng giờ Việt Nam. Không phụ thuộc lịch giao dịch giá.
- Khóa có lease 10 phút chặn hai lượt đồng bộ chồng nhau. Đọc/ghi dữ liệu có phân trang, giới hạn payload RSS 2 MB, timeout và chặn DTD/entity; không vượt 10.000 tin trong cửa sổ 7 ngày để chấm điểm trên tập bị cắt. API Top10 từ chối nếu vượt 2.000 ứng viên thay vì xếp hạng sai trên tập bị cắt.
- Loại trùng theo URL chuẩn hóa, hash tiêu đề và tương đồng từ ≥90%; không gộp tiêu đề có số liệu khác nhau. Tin cùng nội dung từ nhiều feed không được tăng trọng số. Link nguồn giữ bài được thu nhận đầu tiên.
- Tin khuyến mại/ưu đãi/nhận quà được loại khỏi phân tích và điểm tâm lý; đây là bộ lọc theo từ khóa, không thay xác nhận nội dung quảng cáo từ tòa soạn. Bảng ngành chỉ dùng ngành của chính mã, không lấy mọi tin có tag ngành.
- RSS sửa tiêu đề/mô tả: cập nhật snapshot, hủy phân tích cũ và xếp hàng phân tích lại. Mỗi URL chỉ quan sát một lần trong một lượt, theo thứ tự feed cố định.
- Gắn mã bằng ticker nguyên từ/nhắc rõ mã hoặc tên công ty; tránh nhầm VND, CEO, API, CPI với ticker. Ngành lấy từ phân ngành đang có của mã hoặc tên ngành xuất hiện trong RSS. Đây là nhận diện theo quy tắc, có thể thiếu hoặc nhầm; không tự điền ngành chưa có nguồn.
- Dùng bảng mới `news_feed_articles`, `news_sources`, `news_scores`, `news_ingestion_lock`. Giữ nguyên bảng khung `news_articles`/`news_sentiment` từ Phần 1, không xóa dữ liệu cũ. Các bảng tin/điểm đọc công khai, chỉ service role được ghi; lock không có quyền/policy cho anon hoặc người dùng. INFO advisor “RLS enabled no policy” của lock là chủ ý khóa quyền.

## LLM và chống nội dung không có bằng chứng

Adapter API tương thích OpenAI, thay endpoint/model bằng cấu hình. Chỉ gửi tiêu đề/mô tả RSS, không gửi thông tin tài khoản, khóa hay dữ liệu watchlist. RSS là nội dung không tin cậy; system prompt không cho thực thi chỉ dẫn trong tin. Không cấp công cụ cho mô hình.

Bản đầu dùng **tóm tắt trích xuất**: LLM chọn đoạn liên tục 10–360 ký tự nguyên văn từ RSS; bằng chứng nguyên văn phải chứa đoạn đó. Code và PostgreSQL cùng kiểm tra bằng chứng, không chấp nhận nội dung/số liệu mới do mô hình viết thêm. Điều này bảo đảm truy xuất được đoạn gốc, không bảo đảm bản tin hay nhãn mô hình đúng về bản chất.

Nhãn: positive/neutral/negative, high/medium/low, short/medium/long. Cảm xúc mô tả sắc thái thông tin, không dự báo giá. Mỗi lượt xử lý tối đa 6 tin, ưu tiên tin trực tiếp mã rồi thời gian mới nhất. Lỗi thử lại sau ít nhất 1 giờ, tối đa 3 lần. Backlog và tin chưa có phân tích hiện “không đủ dữ liệu”, không gán trung lập. Thay model không tự xóa phân tích cũ; từng bản ghi giữ model và thời điểm của nó.

Cấu hình **Production Worker gốc** `vn-stock-analyzer.manhhuong.workers.dev`:

- Secret: `NEWS_LLM_API_KEY` (không có `NEXT_PUBLIC_`, không đưa vào Git/chat).
- Variables: `NEWS_LLM_BASE_URL` (gốc API, ví dụ `https://api.openai.com/v1`, chưa có `/chat/completions`), `NEWS_LLM_MODEL` (ID model do nhà cung cấp xác nhận).
- `NEWS_WEIGHT=0.1`, `NEWS_RSS_PERMISSION=personal-nonprofit` đã có trong Wrangler. Không đặt khóa vào JSONC.
- Nếu chưa cấu hình đủ, vẫn thu RSS và link nhưng nhãn/điểm LLM là “không đủ dữ liệu”; `system_status.news` degraded. Không gọi nhà cung cấp bằng khóa giả.

Endpoint bảo trì `POST /v1/internal/news-sync` chỉ nhận chữ ký HMAC một phút do script server tạo, so sánh bằng timing-safe comparison; khóa service role không được gửi đến endpoint hoặc vào log HTTP; browser/anon bị từ chối. Không nhận credential qua query, không log credential hoặc phản hồi thô. Dùng `npm run sync:news -- --production` để chạy trong Worker với secrets đã cấu hình; script lấy quyền quản trị trong bộ nhớ, không in key.

## Điểm tin và Top 10

Chỉ tin **gắn trực tiếp một mã duy nhất**, được LLM phân tích hợp lệ, công bố và phân tích không sau thời điểm tính, tuổi ≤7 ngày. Tin nhiều mã vẫn có nhãn cảm xúc chung nhưng không dùng nhãn đó để chấm từng mã vì tác động có thể trái chiều. Tin vĩ mô/ngành chung chỉ làm bối cảnh, không tự cộng điểm cho tất cả mã.

Với sắc thái `s = +1 / 0 / −1`, mức ảnh hưởng `w = 3 / 2 / 1`, tuổi `d` ngày:

`Điểm = 50 + 50 × Σ[s × w × 2^(−d/3)] / Σ[w × 2^(−d/3)]`.

Chỉ có điểm khi phân tích hợp lệ đủ các tin trực tiếp một mã trong cửa sổ RSS; còn tin pending/failed hoặc nguồn lỗi thì null, không dùng phần đã phân tích để tạo điểm đầy đủ. Không có tin hợp lệ → null, **không** phải 50. Một tin được gộp chỉ tính một lần. Hiển thị số tin, số nguồn và link; ít tin là bằng chứng mỏng, không phải mức tin cậy cao.

Điểm kỳ = `(1−trọng số tin) × điểm cơ sở + trọng số tin × điểm tin`. Mặc định 10%; trên Top10 chỉnh 0–30% theo lượt xem. Thiếu tin thì phần trọng số đó không đóng góp và không được phân bổ lại; bao phủ dưới 100% bị loại theo chính sách Phần 4. Trọng số 0 tắt thành phần tin nhưng vẫn giữ bộ lọc giá/BCTC. Ví dụ đáp án tay: điểm cơ sở80, tin100, trọng số10% →82; tin thiếu → đóng góp72, bao phủ90%, không đủ điều kiện xếp hạng.

Cron lưu điểm tổng và snapshot thành phần vào scores/rankings. API lấy toàn bộ ứng viên theo bộ lọc, tính lại trọng số rồi sắp xếp/chọn10; không chỉ đổi điểm trên 10 mã đã chọn trước. Snapshot tin quá1 giờ bị coi thiếu để tránh dùng điểm khi Cron dừng. Không nới yêu cầu dữ liệu tài chính/giá đã xác minh để lấp đầy bảng.

Bảng yếu tố ảnh hưởng là nhóm tin có link, không phải chuỗi định lượng mua/bán ròng, CPI, tỷ giá hay thanh khoản đã đối chiếu dữ liệu giao dịch. Khi thiếu tin/chuỗi số liệu thì ghi không đủ dữ liệu, không suy ra số liệu hoặc hướng tác động.

## Kiểm tra

- `npm run verify`: typecheck/lint/format, unit và coverage≥80% cho module news, build, gitleaks, toàn bộ migration PostgreSQL và RLS, provider tests.
- `npm run sync:news -- --migrate`: áp dụng migration và thu RSS bằng script server; chỉ dùng LLM nếu môi trường script có cấu hình.
- `npm run sync:news -- --production`: chạy Worker thật với secrets của Worker, cập nhật tin và ba kỳ điểm.
- `npm run verify:news:browser`: API và trình duyệt với dữ liệu thật, tài khoản tạm; nguồn/link, trạng thái thiếu hoặc nhãn thật, trọng số Top10, 390px; tự xóa tài khoản thử.
- `MARKET_APP_URL=https://vn-stock-analyzer.manhhuong.workers.dev npm run verify:news:browser`: kiểm tra bản production.
- `NEWS_REQUIRE_LLM=1` cho kiểm tra live nghiêm ngặt: phải có ít nhất một phân tích LLM thật, có bằng chứng nguyên văn. Không bật fixture để vượt kiểm tra này.

Kiểm thử workerd bắt lỗi riêng runtime Cloudflare: dùng `redirect: manual` và từ chối 3xx (Workers không hỗ trợ `error`). Đầu vào xếp hạng đọc qua RPC service-only theo lô100, giữ bộ lọc dữ liệu cũ và tránh N+1 HTTP trong Cron.

Lượt chạy production đã ghi nhận `exceededCpu` ở khoảng 2.000 ms trước khi hoàn tất thu tin. Gói Free không cho đặt `limits.cpu_ms`, nên không khai báo/nâng trần hoặc tự thay gói. Bộ so tiêu đề giữ chữ ký chuẩn hóa trong phạm vi mỗi lượt, dùng phép giao/hợp tập hợp không tạo lại mảng; bộ gắn mã chuẩn bị regex, tên và ngành một lần cho danh mục. Tập tính điểm được nhóm theo mã một lần, tránh sắp xếp/kiểm tra lại toàn bộ tin cho mỗi cổ phiếu. Giữ nguyên tiêu chí nhận diện, loại trùng và công thức. Theo dõi CPU thực tế qua Workers Observability khi tăng khối lượng tin/danh mục.

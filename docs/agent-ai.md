# Trợ lý AI VN Stock

Mở `/agent` sau khi đăng nhập, hoặc nút **Trợ lý AI** trên website/PWA.

## Phạm vi bản đầu

- Hiểu yêu cầu tiếng Việt, phân tích một mã hoặc so sánh tối đa3 mã.
- Giá VPS/snapshot có thời điểm nhận; BCTC năm đã công bố, điểm Graham/Buffett,
  từng tiêu chí, giá trị nội tại, biên an toàn và rủi ro từ engine hiện có.
- Tin RSS trực tiếp theo mã trong7 ngày, dẫn link gốc; không tự tải URL người dùng.
- Xem watchlist/cảnh báo của chính tài khoản; tạo/đổi tên/xóa danh sách, thêm/xóa
  mã, sửa ghi chú/giá mục tiêu; tạo/bật/tắt/xóa cảnh báo vùng mua, vùng bán, cắt lỗ.
- Thay đổi chỉ thực hiện sau khi bấm xác nhận bản xem trước. Ngưỡng giá theo VND.
  Chưa hỗ trợ xóa riêng giá mục tiêu qua hội thoại; dùng trang watchlist khi cần.
- Cảnh báo trong ứng dụng; không gửi email thử, không đặt lệnh thật hoặc lệnh ví thử.

## Kiến trúc và giới hạn

`/agent` → Worker `/v1/agent` → Supabase Auth xác thực → quota theo user →
Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` diễn giải một JSON plan →
validator allowlist → đọc dữ liệu hoặc tạo proposal → người dùng xác nhận →
RPC transaction kiểm tra owner/trạng thái cũ/hạn dùng rồi áp dụng đúng một lần.

Mô hình được kiểm tra trong tài liệu chính thức:
https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
Binding: https://developers.cloudflare.com/workers-ai/configuration/bindings/

Workers AI được khai báo trong `wrangler.jsonc` với binding `AI`, không cần đưa
API key vào browser. Chạy `npm run deploy:worker` hoặc Git integration hiện có.
Tài khoản Cloudflare phải được dùng Workers AI, có quota/đồng ý điều khoản nếu
Cloudflare yêu cầu. Không giả định có cấu hình LLM chỉ vì binding đã được deploy;
phải kiểm tra một request thực tế. Lỗi model/quota/network trả trạng thái lỗi,
không giả lập câu trả lời AI.

Đầu ra dùng JSON Schema bắt buộc đủ trường, theo tài liệu
https://developers.cloudflare.com/workers-ai/features/json-mode/ ; vẫn kiểm tra
lại kiểu và ý nghĩa tham số ở server, không nới validator khi model sai.

Model chỉ định tuyến công cụ/điền tham số, không tự viết số liệu hoặc kết luận
đầu tư. Phân tích được dựng bằng dữ liệu và giải thích của engine; DCF proxy
chưa xác minh vẫn unknown, không biến CFO hợp nhất thành tiền công ty mẹ. Các
công thức và điều kiện xếp hạng không thay đổi trong nhiệm vụ này.

Một inference/lượt, tối đa1200 output token và timeout25 giây. Không có vòng lặp
agent tự chạy, SQL tùy ý, shell, URL fetch tùy ý hoặc công cụ giao dịch. Quota
Supabase atomic:3 lượt/phút,30/giờ,100/ngày mỗi tài khoản; giới hạn IP API/phân
tích hiện có vẫn áp dụng. Đây là giới hạn ứng dụng, không phải quota/SLA nhà
cung cấp. Workers AI có thể tính phí theo gói và lượng sử dụng của tài khoản.

## Dữ liệu cá nhân và xác nhận

- Model nhận yêu cầu/lịch sử tối đa6 câu gần nhất, tên/ID danh sách, mã theo dõi
  và cấu hình cảnh báo để hiểu tham chiếu; không nhận JWT, key server hoặc toàn
  bộ BCTC/tin RSS. Tin hoặc tên danh sách không được biến thành hướng dẫn hệ thống.
- Hội thoại ở bộ nhớ trang, không lưu localStorage/DB; rời trang/đổi tài khoản sẽ
  xóa UI. Dữ liệu đã gửi cho Cloudflare chịu chính sách của nhà cung cấp.
- Proposal lưu riêng, có RLS chỉ owner đọc; action không cho client sửa trực tiếp.
  Bản xem trước mô tả tác động, cảnh báo xóa dây chuyền; hết hạn10 phút.
- Confirm chỉ nhận ID, không nhận payload thay thế hay owner_id. RPC kiểm tra
  `auth.uid()`, row lock, trạng thái trước khi thay đổi; từ chối dữ liệu đã đổi.
- Retry cùng ID không áp dụng trùng; mất mạng sau confirm không được tự tuyên bố
  thành công hoặc thất bại. Người dùng có thể xác nhận lại cùng ID để kiểm tra.
- Đổi ý: bấm Hủy. Proposal hết hạn không thực hiện. Các record đề xuất thuộc tài
  khoản được xóa theo user; chưa có chính sách lưu trữ dài hạn riêng cho proposal.

## Tự kiểm tra

`npm run verify` gồm test unit và SQL RLS agent: preview không ghi watchlist,
2 user không đọc/xác nhận hộ, helper không public, action bất biến, hết hạn,
stale/cancel, idempotency, thao tác watchlist/cảnh báo và quota.

Trên website: “Tạo danh sách Dài hạn” → xem trước → Hủy (không tạo); gửi lại →
Xác nhận. “Thêm FPT vào Dài hạn” → Xác nhận. “Cảnh báo cắt lỗ FPT trong Dài hạn
ở55.000 VND” → xem đúng mã, danh sách, đơn vị rồi xác nhận. Kiểm tra ở trang
watchlist/cảnh báo. “Phân tích FPT” và “So sánh VNM và HPG” phải có nguồn và
nêu dữ liệu thiếu. Bản đầu trả phân tích có cấu trúc, không hội thoại đầu tư
mở hoàn toàn hay cam kết dự báo.

## Kiểm tra trước triển khai

`npm run verify`:9/9 PASS;208 unit PASS,55 provider PASS và1 TODO cũ về
`lastVolume`;21 migration và RLS PASS. Hai process xác nhận cùng đề xuất đồng
thời chỉ tăng alert version từ1 lên2, không lên3.
[Log verify nguyên văn](verify-agent-2026-10-16.txt).

Browser390/1440px: Auth/Supabase/RPC thật, chỉ diễn giải AI được mock; xác nhận
mới tạo danh sách/thêm FPT, hủy đề xuất55000 VND không tạo cảnh báo, không lỗi JS
hoặc tràn ngang; xóa hội thoại xóa UI. [Output](browser-agent-2026-10-16.txt).
Browser thật đã tìm và giúp sửa lỗi giả định PostgREST nối trực tiếp rules→stocks;
hiện lấy tên mã từ các item thuộc chính người dùng.

`npm run verify:agent:live` gọi mô hình Cloudflare thật, tạo2 user thử và tự dọn:
FPT, so sánh VNM/HPG, đề xuất/tạo danh sách, thêm FPT, cảnh báo55000 VND rồi hủy,
kiểm tra hai người dùng và idempotency. Lệnh tách khỏi CI vì phụ thuộc mạng,
quota Workers AI và cần quyền quản trị Supabase để tạo/xóa tài khoản thử. Không
được dùng kết quả browser mock để khẳng định inference thật đã hoạt động.

## Hiệu chỉnh sau kiểm tra thật

- Đọc FPT và so sánh VNM/HPG đã gọi được Cloudflare AI thật ở đợt triển khai đầu.
  JSON object mode bỏ sót/sai trường khi tạo danh sách và bị validator chặn; đã
  chuyển sang JSON Schema, không sửa đáp án test hay bỏ kiểm tra tham số.
- CI smoke không gọi dịch vụ AI: script đọc config sản xuất và tạo bản tạm chỉ
  bỏ binding AI cho local health/HTTP guards. Giữ nguyên handler, assets và
  assertions, thêm Auth401 của agent. `verify:agent:live` kiểm tra inference thật
  riêng; không cần thêm token Cloudflare vào CI để chạy smoke.
- UI xóa hội thoại/bản nháp ngay theo Auth event, gồm đăng xuất từ tab khác và
  đổi người dùng; chờ xác thực user mới trước khi hiển thị phiên chat mới.
- Bản xem trước kiểm tra cả trạng thái thay đổi trong lúc model suy nghĩ, trước
  khi đưa proposal ra giao diện; RPC tiếp tục kiểm tra từ lúc xem trước đến xác nhận.

- Model thử ban đầu Qwen3 có khai báo response_format ở API nhưng không nằm
  trong danh sách JSON Mode được Cloudflare hỗ trợ. Sau khi request schema thật
  bị từ chối, đổi sang Llama3.3 70B fp8-fast có tên trong danh sách hỗ trợ; không
  bỏ schema/validator để chấp nhận plan sai.

- Schema gửi provider chỉ ràng buộc cấu trúc/kiểu cơ bản và đủ trường; mọi regex
  UUID/mã, giá dương/hữu hạn, độ dài và điều kiện từng công cụ vẫn được validator
  server kiểm tra. Lỗi provider được phân loại bằng mã cố định, không trả raw
  provider payload/prompt hoặc credentials cho client.

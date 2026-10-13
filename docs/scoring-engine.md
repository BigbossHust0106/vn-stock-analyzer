# Engine Graham / Buffett — phiên bản 1

Đây là bộ sàng lọc minh bạch 0–100, không phải bản sao đầy đủ tiêu chuẩn của hai nhà
đầu tư. Dùng nguồn BCTC năm hợp nhất đã kiểm toán theo metadata KBS, ROIC/số CP
Vietcap. Mapping/đơn vị/bằng chứng: [data-sources.md](data-sources.md#phần-3--bctc-và-chấm-điểm-13102026).

## Điểm và dữ liệu thiếu

Mỗi tiêu chí trả `pass`, `fail` hoặc `unknown`, điểm tối đa và giải thích tiếng Việt.
Đạt nhận toàn bộ trọng số; không đạt/thiếu nhận 0. Mẫu số luôn 100, **không tái phân
bổ trọng số khi thiếu**. Coverage tính trọng số tiêu chí có dữ liệu/100; thiếu không
đồng nghĩa doanh nghiệp xấu. Chưa có tiêu chí được đánh giá: tổng hợp null, không mua.

| Graham                                                                 | Điểm tối đa |
| ---------------------------------------------------------------------- | ----------- |
| (P/E < 15 và P/B < 1,5) hoặc P/E × P/B < 22,5, bội số dương            | 20          |
| Giá < Graham Number                                                    | 15          |
| Current assets / current liabilities > 2                               | 15          |
| Nợ dài hạn < vốn lưu động và vốn lưu động > 0                          | 15          |
| LNST công ty mẹ dương 3 năm liên tiếp                                  | 15          |
| Cổ tức đã chi 3 năm, không có NCI; có NCI thì thiếu dữ liệu công ty mẹ | 10          |
| Biên an toàn ≥ 25%                                                     | 10          |

Graham Number = √(22,5 × EPS năm VND × BVPS công ty mẹ VND). EPS âm/BVPS0,
thiếu dữ liệu, số CP thay đổi chưa đối chiếu điều chỉnh: “không đủ dữ liệu”.
P/E/P/B lấy giá hiện tại cùng EPS/BVPS, không dùng P/E lịch sử CSTC.
Biên an toàn=(giá trị nội tại−giá)/giá trị nội tại; giá cao hơn cho kết quả âm.
Chuỗi 3 năm là rút gọn, chưa kiểm tra 10 năm lợi nhuận/20 năm cổ tức nguyên bản.

| Buffett                                                                | Điểm tối đa |
| ---------------------------------------------------------------------- | ----------- |
| ROE > 15% và dao động ≤ 5 điểm phần trăm trong 3 năm                   | 20          |
| ROIC năm > 15%                                                         | 15          |
| Biên gộp > 20%, ròng > 10%, mỗi biên dao động ≤ 5 điểm phần trăm/3 năm | 15          |
| Nợ vay/vốn chủ < 50%, không âm                                         | 15          |
| FCF dương và tăng từng năm/3 năm                                       | 15          |
| LNST công ty mẹ dương và tăng từng năm/3 năm                           | 10          |
| Biên an toàn DCF ước tính ≥ 25%                                        | 10          |

Đây là ngưỡng ứng dụng, không tuyên bố Buffett luôn dùng chúng; thiếu năm/năm đứt
không đạt chứng cứ “ổn định”. Tăng trưởng không đủ để xác nhận moat hay quản trị.

## DCF và giả định chỉnh được

Proxy Owner Earnings = CFO hợp nhất − Capex × tỷ lệ maintenance giả định.
Mặc định maintenance=100%, growth=5%, equity discount=12%, terminal growth=2%,
5 năm. CFO đã bao gồm biến động vốn lưu động và lãi vay trả theo báo cáo; không
cộng lại khấu hao hoặc trừ lại vốn lưu động. **Không gọi proxy là FCFE/Owner Earnings
đã xác minh**, chưa tách phần tiền thuộc NCI, chưa cộng tiền dư hay điều chỉnh nợ.
DCF vốn chủ proxy không trừ nợ lần thứ hai. Không áp dụng mô hình cho ngân hàng,
chứng khoán/bảo hiểm hoặc CFO/Owner Earnings không dương.

CF(t)=proxy × (1+growth)^t; terminal=CF(N) × (1+terminalGrowth)/(discount−terminalGrowth).
Giá trị/CP=[Σ CF(t)/(1+discount)^t + terminal/(1+discount)^N] / số CP mới nhất nguồn.
N=1–10, growth=-20…20%, discount=3…50%, terminal=-5…5% và terminal<discount,
maintenance=0…100%; mọi số hữu hạn. Chia 0/thiếu/âm/overflow trả “không đủ dữ liệu”.

## Tổng hợp, mức tin cậy, kết luận

Tổng hợp=Graham × trọng số Graham + Buffett × trọng số Buffett. Trọng số 0–100%
và cộng 100%; mặc định 50/50. Cài đặt DCF và trọng số lưu riêng từng tài khoản trong
`user_settings.scoring_preferences` có RLS; khi chưa đăng nhập lưu trình duyệt.
Điểm cá nhân tính lại ở trình duyệt bằng cùng engine; bảng `scores` chỉ lưu cấu hình
mặc định, horizon=month là nhãn lưu trữ, không phải dự báo lợi nhuận một tháng.

Confidence là **mức hoàn thiện bằng chứng**, không phải xác suất lời: weighted coverage
× hệ số giá mới (1 nếu snapshot ≤24h, khác là0,4) × BCTC mới (1 nếu cuối kỳ ≤550 ngày,
khác là0,5) ×0,65 (chưa chứng nhận PDF) ×0,8 nếu Buffett có trọng số (proxy DCF).
Làm tròn phần trăm. Cấu hình nguồn hiện tại tối đa65%; do đó **kết luận hiện tại
luôn Quan sát**, dù điểm cao. Không cho phép nâng confidence bằng form.

Quy tắc đầy đủ cho khi có nguồn được chứng nhận trong tương lai: confidence<70%,
thiếu score/biên an toàn → Quan sát; score<35 hoặc MOS<−20% → Tránh; score≥80 và
MOS≥25% → Mua; score≥65 và MOS≥10% → Tích lũy; score≥50 và MOS≥0 → Nắm giữ;
còn lại Quan sát. MOS kết luận lấy nhỏ nhất của các chiến lược có trọng số. Hiện
không có cờ vận hành để bỏ trần65%; cần phiên bản mô hình mới sau chứng nhận nguồn.

## Đồng bộ và vận hành

`npm run sync:financials -- --migrate`: áp dụng migration thiếu bằng Management API,
fetch **live** VNM/FPT/HPG (hoặc SYNC_SYMBOLS), lưu fundamentals, snapshot, scores.
Không lấy fixture làm dữ liệu production. RPC ghi chỉ service_role, public read,
khóa theo stock chống concurrent writer và payload cũ. Score trigger chặn computation
cũ hoặc financial inputs cũ ghi đè. Dùng transaction cho script đồng bộ.

Worker `GET /v1/financials/{symbol}` chỉ chấp nhận mã đang active trong catalog,
đọc DB với publishable key, snapshot24h, fetch provider khi cần; nguồn lỗi dùng snapshot
với thông báo. Chỉ service-role secret Worker được ghi background. Job16:00 Việt Nam
ngày thường sau đồng bộ thị trường cũng đồng bộ BCTC/điểm nhóm SYNC_SYMBOLS. Chưa xác
minh cron thực sự chạy theo lịch trên production; giờ này không thay thế lịch phiên/nghỉ lễ.
BCTC không suy ra phiên giao dịch hay OHLC và không điền ngày giá không có phiên.

`npm run verify` chạy toàn bộ test offline, migration và RLS. `npm run verify:financials:live`
chỉ đọc provider thực, tách CI. `npm run verify:scoring:browser` cần app đang chạy,
kiểm tra VNM/FPT/HPG, trọng số100/0, reload và mobile390px. `npm run verify:settings:live` đã kiểm thử 2 user Auth hosted tạm thời bằng password/JWT,
A không đọc/sửa/giả mạo preferences B; sau đó xóa users và rows cascade. Lệnh cần
Management token qua Environment Secrets, tạo/xóa dữ liệu kiểm thử, tách khỏi CI.
Kiểm tra browser hiện xác minh cài đặt khách; UI login cá nhân vẫn cần tài khoản riêng.

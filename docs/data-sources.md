# Nguồn dữ liệu và mức độ xác minh

## Giá hiện tại VPS

Endpoint người dùng xác nhận: `GET https://bgapidatafeed.vps.com.vn/getliststockdata/{mã1,mã2,...}`.
Các mã ngăn cách bằng dấu phẩy. Đây là endpoint **không chính thức**, không có
cam kết ổn định; có thể đổi schema, đổi giới hạn, yêu cầu xác thực hoặc bị chặn.
Không tự thêm endpoint dự phòng. Provider chỉ gửi tối đa 50 mã mỗi batch (giới hạn
thận trọng của ứng dụng, KHÔNG phải giới hạn đã xác minh của VPS).

Nguồn fixture: toàn bộ JSON người dùng dán trong phiên làm việc, lưu tại
`fixtures/vps-getliststockdata-sample.json`, 30 mã, 57 trường mỗi bản ghi. Người dùng đã xác nhận ACB thuộc ngày 12/10/2026 và đối chiếu chart ngày
cùng ngày. Chưa có timestamp sàn trong phản hồi; chưa đối chiếu ngày từng mã khác. Không dùng fixture làm dữ liệu thật của ứng dụng.

Mức "chắc chắn" ở đây là đối chiếu với số liệu bảng giá ACB do người dùng xác nhận,
không phải kiểm chứng bằng một lần gọi mạng thành công của agent. Gọi thật trong
cloud trong onboarding ngày 12/10/2026 bị proxy từ chối CONNECT HTTP 403.
Khảo sát bổ sung 13/10/2026 gọi VPS nhận HTTP503. Đã thêm domain vào bản nháp môi trường;
bản nháp chưa tự áp dụng vào mạng đang chạy. `npm run verify:live` tách riêng,
không chạy trong CI.

## Danh sách TẤT CẢ trường

Kiểu là kiểu quan sát trong fixture, không khẳng định là spec đầy đủ cho mọi sàn,
phiên đấu giá hay chứng quyền. Validator yêu cầu các trường này và từ chối kiểu
mới (kể cả các trường hiện chỉ thấy null) với đường dẫn lỗi để cập nhật có kiểm chứng.
Trường thêm được giữ trong raw response nhưng không tự diễn giải.

| Trường              | Kiểu trong mẫu | Mẫu ACB                      | Mức độ / diễn giải                                                                                                                                                                                    |
| ------------------- | -------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | number         | `2100`                       | **Chưa chắc**: Mã nội bộ của bản tin/board? Tất cả = 2100; không phải ID duy nhất cổ phiếu.                                                                                                           |
| `boardId`           | string         | `G1`                         | **Chưa chắc**: Có thể định danh board; mẫu G1, chưa biết quy ước.                                                                                                                                     |
| `marketId`          | string         | `STO`                        | **Chưa chắc**: Có thể định danh thị trường; mẫu STO. Không tự ánh xạ thành HOSE/HNX/UPCOM.                                                                                                            |
| `channel`           | null           | `null`                       | **Chưa chắc**: Chỉ quan sát null; không đủ dữ kiện để định nghĩa.                                                                                                                                     |
| `tradingSession`    | null           | `null`                       | **Chưa chắc**: Chỉ null; chưa xác minh mã phiên hay thời gian.                                                                                                                                        |
| `g7`                | string         | `0\|0\|e`                    | **Chưa chắc**: Mẫu 0 / 0 / e; không đủ bằng chứng để đặt tên mức này.                                                                                                                                 |
| `mp`                | null           | `null`                       | **Chưa chắc**: Chỉ null; không xác định nghĩa.                                                                                                                                                        |
| `lv`                | number         | `0`                          | **Chưa chắc**: Mẫu 0; không xác định nghĩa.                                                                                                                                                           |
| `matureDate`        | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý ngày đáo hạn; mẫu rỗng, chưa xác minh.                                                                                                                                       |
| `mkStatus`          | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý trạng thái thị trường; mẫu rỗng.                                                                                                                                             |
| `ptVol`             | string         | `0`                          | **Chưa chắc**: Tên có thể gợi ý khối lượng thỏa thuận; mẫu 0, đơn vị chưa rõ.                                                                                                                         |
| `oi`                | string         | `0`                          | **Chưa chắc**: Tên có thể gợi ý open interest; mẫu 0, chưa xác minh.                                                                                                                                  |
| `oichange`          | string         | `0`                          | **Chưa chắc**: Tên có thể gợi ý thay đổi oi; mẫu 0.                                                                                                                                                   |
| `side`              | string         | `(rỗng)`                     | **Chưa chắc**: Mẫu rỗng; chưa xác định quy ước buy/sell.                                                                                                                                              |
| `productId`         | string         | `S1STOST`                    | **Chưa chắc**: Có thể mã sản phẩm; S1STOST, chưa có bảng mã.                                                                                                                                          |
| `rightInfos`        | null           | `null`                       | **Chưa chắc**: Tên gợi ý thông tin quyền; chỉ null, chưa có schema.                                                                                                                                   |
| `CWUnderlying`      | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý cổ phiếu cơ sở chứng quyền; mẫu rỗng.                                                                                                                                        |
| `CWIssuerName`      | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý tổ chức phát hành chứng quyền; mẫu rỗng.                                                                                                                                     |
| `CWType`            | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý loại chứng quyền; mẫu rỗng.                                                                                                                                                  |
| `CWMaturityDate`    | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý ngày đáo hạn chứng quyền; mẫu rỗng.                                                                                                                                          |
| `CWLastTradingDate` | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý ngày giao dịch cuối chứng quyền; mẫu rỗng.                                                                                                                                   |
| `CWExcersisePrice`  | string         | `(rỗng)`                     | **Chưa chắc**: Giữ nguyên cách viết Excersise của wire; có thể giá thực hiện, mẫu rỗng, không rõ đơn vị.                                                                                              |
| `CWExerciseRatio`   | string         | `0:0`                        | **Chưa chắc**: Tên gợi ý tỷ lệ thực hiện; mẫu 0:0, không chia hay coi là tỷ lệ hợp lệ.                                                                                                                |
| `CWListedShare`     | string         | `(rỗng)`                     | **Chưa chắc**: Tên gợi ý số chứng quyền niêm yết; mẫu rỗng.                                                                                                                                           |
| `sType`             | string         | `S`                          | **Chưa chắc**: Mẫu S; có thể loại chứng khoán nhưng chưa xác minh bảng mã.                                                                                                                            |
| `sBenefit`          | string         | `0`                          | **Chưa chắc**: Mẫu 0; không đủ dữ kiện để định nghĩa.                                                                                                                                                 |
| `sym`               | string         | `ACB`                        | **Chắc chắn với ACB**: Mã ACB đúng mã người dùng đối chiếu; các mã khác được giữ nguyên.                                                                                                              |
| `symCode`           | string         | `VN000000ACB8`               | **Chưa chắc**: Có hình thức mã ISIN; chưa xác minh metadata chính thức.                                                                                                                               |
| `sequence`          | number         | `113859`                     | **Chưa chắc**: Có thể số thứ tự bản tin, không phải timestamp.                                                                                                                                        |
| `sourceMsgType`     | string         | `MT`                         | **Chưa chắc**: Có thể loại bản tin; mẫu MT và X, chưa biết ý nghĩa mã.                                                                                                                                |
| `c`                 | number         | `21.55`                      | **Chắc chắn với ACB**: Giá trần: 21.55 khớp bảng giá người dùng đối chiếu; nghìn VND.                                                                                                                 |
| `f`                 | number         | `18.75`                      | **Chắc chắn với ACB**: Giá sàn: 18.75 khớp đối chiếu; nghìn VND.                                                                                                                                      |
| `r`                 | number         | `20.15`                      | **Chắc chắn với ACB**: Giá tham chiếu: 20.15 khớp đối chiếu; nghìn VND.                                                                                                                               |
| `lastPrice`         | number         | `20.45`                      | **Đã đối chiếu ACB 1 ngày**: ACB 12/10/2026 C=20.45 khớp chart; nghìn VND. Chưa đối chiếu thêm mã/ngày/sàn; timestamp sàn chưa có.                                                                    |
| `lastVolume`        | number         | `1440`                       | **Chưa chắc**: Raw 1440 chưa có số khớp cuối đối chiếu; giữ nguyên, không chuẩn hóa hay dùng scoring/rankings. Test pending có chú thích.                                                             |
| `lot`               | number         | `796910`                     | **Đã xác minh trên 1 mã, cần đối chiếu thêm**: Tổng khối lượng ngày theo lô 10 cổ phiếu. ACB 12/10/2026: 796910 × 10 = 7.969.100 cổ phiếu, chart VPS 7,969 M. Không áp dụng hệ số này cho lastVolume. |
| `ot`                | string         | `0.30`                       | **Chưa chắc**: Mẫu bằng abs(lastPrice - r), bỏ dấu tăng/giảm; không dùng làm thay đổi có dấu.                                                                                                         |
| `changePc`          | string         | `1.49`                       | **Chưa chắc**: Mẫu gần abs(lastPrice - r)/r*100 (làm tròn), bỏ dấu; không dùng làm return có dấu.                                                                                                     |
| `avePrice`          | string         | `20.35`                      | **Chưa chắc**: Tên gợi ý giá bình quân, cùng thang nghìn VND; chưa xác minh phương pháp/đơn vị.                                                                                                       |
| `highPrice`         | string         | `20.55`                      | **Đã đối chiếu ACB 1 ngày**: H=20.55 khớp chart VPS 12/10/2026, nghìn VND. Không dùng để xây lịch sử.                                                                                                 |
| `lowPrice`          | string         | `20.15`                      | **Đã đối chiếu ACB 1 ngày**: L=20.15 khớp chart VPS 12/10/2026, nghìn VND. Không phải xác nhận mọi phiên.                                                                                             |
| `g1`                | string         | `20.45\|14740\|i`            | **Chưa chắc**: Có thể mua 1, price / volume / marker; chưa được bảng giá đối chiếu.                                                                                                                   |
| `g2`                | string         | `20.4\|11140\|i`             | **Chưa chắc**: Có thể mua 2, price / volume / marker; chưa được đối chiếu.                                                                                                                            |
| `g3`                | string         | `20.35\|17200\|i`            | **Chắc chắn phần giá với ACB**: Giá mua 3 = 20.35 khớp đối chiếu. Volume 17200 và marker i chưa rõ nghĩa/đơn vị.                                                                                      |
| `g4`                | string         | `20.5\|61820\|i`             | **Chưa chắc**: Có thể bán 1, price / volume / marker; chưa xác minh.                                                                                                                                  |
| `g5`                | string         | `20.55\|18630\|i`            | **Chưa chắc**: Có thể bán 2, price / volume / marker; chưa xác minh.                                                                                                                                  |
| `g6`                | string         | `20.6\|10600\|i`             | **Chưa chắc**: Có thể bán 3, price / volume / marker; chưa xác minh.                                                                                                                                  |
| `closePrice`        | string         | `20150.0`                    | **Chưa chắc về ngữ nghĩa; thang số quan sát được**: Tất cả mẫu closePrice = r*1000. ACB 20150.0 tương ứng 20150 VND. Không kết luận là giá đóng cửa hiện tại hay lịch sử.                             |
| `openPrice`         | string         | `20.2`                       | **Đã đối chiếu ACB 1 ngày**: O=20.20 khớp chart VPS 12/10/2026, nghìn VND. Không phải endpoint lịch sử.                                                                                               |
| `fBVol`             | string         | `243550`                     | **Chưa chắc**: Tên gợi ý khối lượng nước ngoài mua; chưa xác nhận đơn vị.                                                                                                                             |
| `fBValue`           | string         | `4.9555905E7`                | **Chưa chắc**: Tên gợi ý giá trị nước ngoài mua; hỗ trợ scientific notation, chưa rõ thang tiền.                                                                                                      |
| `fSVolume`          | string         | `445601`                     | **Chưa chắc**: Tên gợi ý khối lượng nước ngoài bán; chưa xác nhận đơn vị.                                                                                                                             |
| `fSValue`           | string         | `9.064022925E7`              | **Chưa chắc**: Tên gợi ý giá trị nước ngoài bán; chưa rõ thang tiền.                                                                                                                                  |
| `fRoom`             | string         | `38699038.10`                | **Chưa chắc**: Tên gợi ý room nước ngoài. GVR âm -2272899.60; không ép về 0 hay suy ra cổ phiếu.                                                                                                      |
| `hashValue`         | string         | `ACB`                        | **Chưa chắc**: Quan sát bằng sym ở tất cả mẫu; ý nghĩa hash chưa xác minh.                                                                                                                            |
| `transId`           | string         | `STO:VN000000ACB8:MT:113859` | **Chưa chắc**: Quan sát chuỗi marketId:symCode:sourceMsgType:sequence; không suy ra timestamp.                                                                                                        |
| `mc`                | string         | `10`                         | **Chưa chắc**: Mẫu đều 10. Không suy ra sàn từ mã này.                                                                                                                                                |

## Đơn vị: điều biết được và chưa biết

- ACB: `r=20.15`, `c=21.55`, `f=18.75`, giá trong `g3=20.35` là **nghìn VND**
  theo đối chiếu người dùng. Chuẩn hóa lần lượt thành 20150, 21550, 18750, 20350 VND.
- `lastPrice` ACB 20.45 khớp C=20.45 trên chart ngày 12/10/2026 người dùng
  đối chiếu; quy đổi 20450 VND. Parser ghi mức xác minh ACB một ngày; các mã
  khác vẫn là suy luận theo contract này, cần đối chiếu thêm.
- `closePrice` có thang **VND** theo quan sát `Number(closePrice) = r*1000` ở 30/30
  bản ghi. Không nhân thêm 1000 và không dùng trường này làm close ngày lịch sử.
- `lot`: **đã xác minh trên 1 mã, cần đối chiếu thêm**. Cấu hình
  `VPS_LOT_SIZE = 10` ở `modules/providers/vps-config.ts`, chỉ dùng cho trường này.
  ACB 796910 × 10 = **7.969.100 cổ phiếu**, phù hợp chart làm tròn **7,969 M**.
  Giữ `volumeRaw.lot` và trả thêm `totalVolumeShares`; database dùng cột generated
  `total_volume_shares = lot_raw * vps_lot_size`, giữ evidence scope ACB_2026-10-12_only.
- `lastVolume=1440`, volume trong `g1..g7`, `ptVol`, `fBVol`, `fSVolume`:
  **chưa đủ bằng chứng phân biệt cổ phiếu hay lô**. Không dùng VPS_LOT_SIZE cho
  những trường này. `lastVolume` giữ raw, `last_volume_unit=unverified`, không dùng
  trong scoring/rankings. Có `it.todo` chờ số đối chiếu khối lượng khớp cuối.
- `fBValue`/`fSValue` có scientific notation. Riêng ACB,
  `49555905 / 243550 ≈ 203.474` so với giá quanh 20.35. Tỷ số này có thể do hệ số
  khối lượng, đơn vị tiền hoặc cả hai; không đủ để kết luận. Cần đối chiếu cả
  khối lượng và giá trị nước ngoài trên bảng giá cùng thời điểm.
- Marker `i/d/e` và mã sàn `mc=10` chưa được xác minh; không dùng cho màu tăng/giảm
  hay để điền exchange. `ot`/`changePc` trong mẫu giảm giá vẫn dương (BID/BSR),
  nên không dùng làm biến động có dấu.
- `fetchedAt` là thời điểm máy nhận phản hồi, **không phải** timestamp sàn hay ngày
  phiên. `sequence`, `transId` không có chứng cứ là timestamp. Price basis
  adjusted/unadjusted của snapshot chưa xác minh.

## Parser, cache, retry và test

`VpsRawQuote`/`VpsResponse` mô tả đúng 57 trường quan sát; validator báo lỗi
`VPS $[index].field: ...`, không in payload. Test kiểm tra thiếu/sai kiểu cho từng
trường, NaN/Infinity, dữ liệu rỗng, scientific notation, room âm, book tuple,
mã trùng/thiếu/trả dư. ACB được kiểm tra với đáp án đối chiếu cố định.

Cache 15 giây mỗi batch (tối đa 30 batch), bản sao tránh mutation; serialize
requests và cách ít nhất 1 giây. Retry network/429/5xx tối đa 2 lần, backoff
500ms/1000ms, timeout mỗi lần 10s; tuân thủ Retry-After, bỏ lần retry nếu yêu cầu
chờ >30s. 401/403 không retry. Các giới hạn này là lựa chọn vận hành, cần điều
chỉnh theo chính sách VPS được xác nhận. Cache/rate limit thuộc mỗi isolate;
chưa phải giới hạn tổng toàn hệ thống. API công khai đọc snapshot Supabase,
không gọi VPS theo từng request người dùng.

## Còn thiếu

1. Lịch sử OHLCV: đã tìm và gọi thật endpoint KBS/Vietcap trong khảo sát
   [13/10/2026](api-research-2026-10-13.md). OHLC 4 mã khớp nhưng volume SHS lệch;
   basis và quyền production chưa xác minh. Chưa có adapter ingest lịch sử,
   không suy ra OHLCV từ quote hiện tại, không ghi snapshot vào `prices_daily`.
2. BCTC ACB: đã nhận payload thật từ KBS và Vietcap (BALANCE_SHEET), chưa
   xác minh mapping EPS năm/TTM, BVPS, FCFE, số cổ phiếu và đơn vị với báo cáo gốc.
   Bảng `fundamentals`, `scores`, `rankings` vẫn chỉ là hạ tầng ở Phần 1.
3. Đối chiếu thêm đơn vị lot ở nhiều mã/ngày/sàn; xác minh lastVolume,
   volume sổ lệnh, giá trị nước ngoài, timestamp phiên, mã sàn,
   quy ước marker, dữ liệu trước mở cửa/đấu giá/ngừng giao dịch/HNX/UPCOM/chứng quyền.
4. Danh mục mã và sàn cùng lịch phiên/ngày nghỉ có nguồn chính thức. `stocks` và
   `trading_sessions` không được seed bằng fixture hay giả định cuối tuần.
5. Nguồn tin tức, quyền sử dụng và mô hình sentiment; Phần 1 không thu thập tin.

## Bằng chứng bổ sung người dùng xác nhận

ACB ngày **12/10/2026**, chart VPS: **O 20,20 / H 20,55 / L 20,15 / C 20,45**,
tham chiếu **20,15**, thay đổi **+0,30 (+1,49%)**, tổng khối lượng **7,969 M**.
Các giá là nghìn VND. Bằng chứng khớp fixture O/H/L/lastPrice/r và hệ số `lot × 10`.
Đây là bằng chứng **1 mã, 1 ngày**, chưa đại diện mọi sàn hay quy ước đấu giá.
Không có số đối chiếu cho `lastVolume=1440`. Không sửa đáp án ACB trong test để
khớp code; đáp án và hệ số ở test lấy từ bằng chứng này. Không tạo endpoint lịch sử.

## Khảo sát nguồn bổ sung

Xem [API research 13/10/2026](api-research-2026-10-13.md) để có endpoint thật,
đối soát ACB/FPT/SHS/QNS, SSI chính thức cần credentials, ứng viên thương mại và
giới hạn sử dụng. Chạy `npm run verify:sources` để đối chiếu live KBS/Vietcap;
REVIEW_NEEDED/exit 2 khi volume SHS lệch là phát hiện chất lượng dữ liệu, không PASS.
Parser khảo sát không tự đổi Cron/provider và không ghi dữ liệu chưa xác minh vào DB.

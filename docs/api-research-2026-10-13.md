# API chứng khoán Việt Nam: khảo sát ngày 13/10/2026

## Kết luận sử dụng

**Đề xuất cho prototype/nghiên cứu: KBS để khảo sát OHLCV lịch sử, Vietcap để
đối soát độc lập.** Đã gọi thật cả hai trên ACB, FPT, SHS, QNS ngày 12/10/2026,
nhận JSON có dữ liệu. Chưa chứng nhận hai nguồn độc lập ở tầng feed gốc; chỉ độc
lập ở endpoint/nhà cung cấp. Chưa dùng chúng làm fallback production hay tự ghi
vào Supabase vì còn thiếu định nghĩa volume, price basis và điều kiện sử dụng.

**Đề xuất ưu tiên đánh giá cho production: SSI FastConnect Data.** Có SDK và
spec do SSI công bố, hỗ trợ danh mục, EOD/OHLC và streaming; cần đăng ký dịch vụ,
consumer credentials và xác nhận quyền dùng cho ứng dụng web/cấp dữ liệu cho người
dùng. Không khẳng định chi phí, SLA hay quyền phân phối lại khi chưa có hợp đồng.

VPS của người dùng **không bị kết luận là sai**: fixture ACB và đơn vị lot đã có
bằng chứng đối chiếu. Hạn chế hiện tại là endpoint quote không phải nguồn lịch sử/
BCTC được xác nhận, timestamp/basis chưa rõ và lần gọi trong khảo sát này trả 503.
Giữ adapter VPS hiện có; module mới chỉ khảo sát dữ liệu, không đổi nguồn Cron.

## Nguồn và bằng chứng

| Nguồn                | Xác minh tài liệu/mã nguồn                               | Gọi thật trong môi trường này                               | Vai trò đề xuất                                        |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| VPS getliststockdata | Fixture do người dùng cung cấp; 57 trường                | Ngày 13/10 HTTP503; không có JSON dữ liệu mới               | Quote hiện tại khi truy cập được, có giới hạn chứng cứ |
| KBS KB Buddy         | Endpoint tìm trong mã nguồn Vnstock; JSON thật đối chiếu | HTTP200, OHLC 4 mã/1 phiên; BCTC ACB có Head/Content        | Ứng viên prototype và khảo sát BCTC                    |
| Vietcap              | Endpoint/payload tìm trong mã nguồn Vnstock              | HTTP200, OHLC 4 mã; BCTC BALANCE_SHEET successful=true      | Đối soát lịch sử và khảo sát BCTC                      |
| SSI FastConnect Data | SDK/spec first-party SSI                                 | HTTP200 nhưng JSON status=401, Missing Authorization header | Ứng viên production sau khi có credentials/quyền       |
| FiinQuant            | Đã đọc website, pricing, trang document chính thức       | Trang web HTTP200; chưa gọi API dữ liệu có xác thực         | Lựa chọn thương mại cần xác nhận gói, quyền và API/SDK |

Các endpoint KBS/Vietcap là endpoint web được quan sát, **không được coi là API
đối tác chính thức hay có SLA** chỉ vì truy cập không cần key ở lần khảo sát.
Không sao chép/cài Vnstock hoặc chạy mã thư viện; mã khảo sát TypeScript viết riêng
từ phản hồi nhận được. URL/tham số lấy từ nguồn bên dưới, không tự bịa endpoint.

## Endpoint đã thử

### KBS: lịch sử ngày

```text
GET https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/ACB/data_day
    ?sdate=12-10-2026&edate=12-10-2026
```

Phản hồi thật ACB:

```json
{
  "symbol": "ACB",
  "data_day": [
    {
      "t": "2026-10-12 07:00",
      "o": 20200,
      "h": 20550,
      "l": 20150,
      "c": 20450,
      "v": 7969100,
      "va": 162164305000
    }
  ]
}
```

Trên ACB, giá raw là **VND**, volume 7969100 khớp bằng chứng người dùng.
Không nhân giá raw thêm 1000. Vnstock có bước chia raw KBS cho 1000 khi xuất
DataFrame, nên dùng dữ liệu raw/đầu ra thư viện lẫn nhau sẽ sai đơn vị.
`va` chưa đưa vào parser hay scoring vì đơn vị/phạm vi chưa chứng nhận.
`t` là nhãn bar, không phải chứng cứ sàn giao dịch lúc 07:00. Parser dùng phần
ngày, giữ `priceBasis=unverified`, `volumeDefinition=unverified`.

### Vietcap: chart OHLC

```text
POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart
Content-Type: application/json
```

```json
{
  "timeFrame": "ONE_DAY",
  "symbols": ["ACB"],
  "to": 1791824400,
  "countBack": 5
}
```

`to` tương ứng 13/10/2026 00:00 giờ Việt Nam. Response là mảng theo symbol, với
các mảng `o,h,l,c,v,t`. Parser kiểm tra chiều dài bằng nhau và đổi epoch sang ngày
theo Asia/Ho_Chi_Minh. Giá raw ACB cùng thang VND như KBS; timestamp bar không được
coi là giờ khớp lệnh. Các trường accumulatedValue/accumulatedVolume không dùng để
suy ra định nghĩa volume hay đơn vị tiền khi chưa đối chiếu.

### KBS: bảng giá hiện tại

```text
POST https://kbbuddywts.kbsec.com.vn/iis-server/investment/stock/iss
```

```json
{ "code": "ACB,FPT,SHS,QNS" }
```

Mẫu trước phiên có `SB,RE,CL,FL,FR,FO,EX,MS,IT,CA`, chưa có CP/khối lượng khớp.
`EX` xác nhận ACB/FPT=HOSE, SHS=HNX, QNS=UPCOM ở lần gọi này. Không dùng mẫu này
để chứng nhận schema quote trong phiên, không coi RE là giá khớp cuối.
QNS reference=50800 trong mẫu sáng 13/10, trong khi close 12/10=50900: không
được mặc định reference luôn bằng close trước hay kết luận lỗi dữ liệu. Nguyên
nhân/quy tắc reference cần kiểm chứng riêng.

### BCTC: hai nguồn có phản hồi thật

```text
GET https://kbbuddywts.kbsec.com.vn/iis-server/investment/stock/finance-info/ACB
    ?page=1&pageSize=2&type=CDKT&unit=1000&termtype=1&languageid=1

GET https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/ACB/financial-statement
    ?section=BALANCE_SHEET
```

KBS trả `Audit,Unit,Head,Content`, có năm 2025/2024, thông tin hợp nhất/kiểm toán và
ngày công bố/cập nhật. **`Unit` ở cấp root có HN=Hợp nhất, ĐL=Đơn lẻ, CTM=Công ty mẹ,
không phải danh mục đơn vị tiền.** Tham số unit=1000 xuất hiện trong client nguồn;
chưa đối chiếu số tiền với báo cáo kiểm toán để chứng nhận phép đổi đơn vị.

Vietcap gọi section viết thường `balance_sheet` ban đầu trả HTTP200 nhưng
`successful=false`, status=400. Sau khi đọc `_IQ_FINANCE_REPORT` và sửa thành
`BALANCE_SHEET`, nhận successful=true, status=200, `data.years` 8 bản ghi và
`data.quarters` 34 bản ghi. Không giả định kết quả đã sắp xếp mới nhất trước.
Raw có ticker/yearReport/lengthReport/publicDate và mã chỉ tiêu `bsa...`; chưa
chứng nhận mapping chỉ tiêu, đơn vị, số liệu hồi tố hoặc khác biệt ngân hàng/doanh nghiệp.

**Chưa đưa EPS/BVPS/FCFE vào scoring.** Cần đối chiếu báo cáo gốc, phân biệt năm/
TTM/quý, hợp nhất/riêng, tiền/cổ phiếu, thời điểm công bố và phiên bản điều chỉnh.
Có payload BCTC không có nghĩa mọi chỉ tiêu tài chính cần thiết đã được xác minh.
Không lưu toàn bộ BCTC vào repo hay tự seed fundamentals từ khảo sát này.

### SSI: chính thức, yêu cầu xác thực

SDK first-party khai báo:

```text
POST https://fc-data.ssi.com.vn/api/v2/Market/AccessToken
GET  https://fc-data.ssi.com.vn/api/v2/Market/Securities
GET  https://fc-data.ssi.com.vn/api/v2/Market/DailyOhlc
GET  https://fc-data.ssi.com.vn/api/v2/Market/DailyStockPrice
```

Tài liệu v2.2 có DailyOhlc: range tối đa 30 ngày, phân trang; DailyStockPrice có
`Closepriceadjusted`, nhưng không tự suy ra cách điều chỉnh đủ cho toàn bộ OHLC.
Các giới hạn/semantics cần xác nhận với gói hiện hành khi tích hợp. Không khẳng định
SDK này cung cấp đủ báo cáo tài chính chỉ vì tài liệu dùng từ “fundamental information”.

Thử GET DailyOhlc không token nhận **HTTP200, JSON status=401**. Đây là lỗi
xác thực, không phải dữ liệu thành công. Chưa có SSI_CONSUMER_ID/SSI_CONSUMER_SECRET
trong tên biến môi trường/binding đã kiểm tra. Cấp credentials qua settings an toàn
khi chọn tích hợp; không gửi secret trong chat. SDK hướng dẫn lấy chúng qua iBoard.
MIT của SDK không tự cấp quyền phân phối lại dữ liệu SSI.

## Đối soát thực tế ngày 12/10/2026

| Mã  | Sàn theo EX KBS | OHLC KBS=Vietcap (VND)        | Volume KBS | Volume Vietcap | Kết luận                                        |
| --- | --------------- | ----------------------------- | ---------- | -------------- | ----------------------------------------------- |
| ACB | HOSE            | 20200 / 20550 / 20150 / 20450 | 7969100    | 7969100        | Khớp mẫu và bằng chứng người dùng               |
| FPT | HOSE            | 58100 / 58800 / 57100 / 57100 | 5930000    | 5930000        | Khớp hai endpoint, chưa phải kiểm toán feed gốc |
| SHS | HNX             | 11800 / 12000 / 11600 / 11700 | 4050300    | 4055903        | Volume lệch 5603, cần xác minh định nghĩa       |
| QNS | UPCOM           | 51800 / 51800 / 50600 / 50900 | 77900      | 77900          | Khớp hai endpoint trong một phiên               |

Không giải thích chênh SHS là lô lẻ/thỏa thuận/điều chỉnh nếu chưa có tài liệu.
Không tự chọn volume lớn hơn, lấy trung bình hay sửa fixture. Một ngày không chứng
minh độ sâu lịch sử, rate limit, uptime, tất cả mã/sàn hoặc corporate-action basis.

## Công cụ khảo sát và điều kiện chuyển sang ứng dụng

`npm run verify:sources` gọi KBS/Vietcap đọc-only; mặc định 4 mã và ngày đối chiếu,
không ghi database, không tự thay VpsProvider. Dùng Node 24 `--use-env-proxy` để
fetch đi qua proxy cấu hình của cloud; đã chẩn đoán fetch thiếu proxy và thử lại
thành công. Giữ TLS verification. Lệnh cách request 1 giây, giới hạn 10 mã;
không tìm cách vượt giới hạn hay giả danh browser.

Exit code: **0** khi các giá/volume khớp, **2** khi có REVIEW_NEEDED, **1** khi
mạng/schema/thiếu bar không hợp lệ. Không chạy live trong CI. Fixture thật nằm ở
`fixtures/source-research/2026-10-13/`, manifest ghi URL/query/payload và checksum
sau định dạng; chỉ gồm dữ liệu bar mẫu, trạng thái trước phiên và lỗi SSI không auth,
không lưu Authorization, cookie hay secret. Unit test bắt buộc phát hiện volume SHS lệch.

Trước khi bật history/fundamentals trong production:

1. Xác nhận quyền sử dụng/công khai/cache với chủ dữ liệu, quota và credentials nếu có.
2. Kiểm chứng đơn vị, giá điều chỉnh/corporate actions, định nghĩa volume,
   lịch/ngày phiên và quy tắc publication/as-of.
3. Chọn một chuỗi/định nghĩa nhất quán, provenance theo source/version; không đổi
   nguồn giữa chuỗi RSI/MACD/ATR hoặc âm thầm blend các trường khi nguồn lỗi.
4. Tạo adapter và kiểm thử theo contract đã xác nhận. Parser khảo sát hiện luôn
   đánh dấu basis/volumeDefinition unverified, chưa đáp ứng ingest `prices_daily`.

## Tài liệu đã đọc và phạm vi quyền

- [SSI SDK chính thức](https://github.com/SSI-Securities-Corporation/python-fcdata/tree/8dc60b660e9bc21ff73090271ac6f1eacb41f54f):
  README, model/api.py, model/model.py và hai PDF trong docs/; spec v2.2 mục 4.6/4.9.
  [iBoard đăng ký/quản lý API](https://iboard.ssi.com.vn/support/api-service/management).
- [Vnstock snapshot mã nguồn](https://github.com/thinh-vu/vnstock/tree/88825be3f9aab729362e6fca178eb6e9ae4d3f88):
  explorer/kbs/const.py, quote.py, trading.py, financial.py; explorer/vci/const.py,
  quote.py, financial.py. Đây là chứng cứ tìm endpoint, không phải xác nhận của KBS/Vietcap.
- [Giấy phép Vnstock trong snapshot](https://github.com/thinh-vu/vnstock/blob/88825be3f9aab729362e6fca178eb6e9ae4d3f88/LICENSE.md):
  license-2026.09, source-available, không phải OSI, không cấp quyền dữ liệu bên
  thứ ba; phần mềm/data access product có điều kiện riêng. Không mô tả Vnstock là
  API chính thức hoặc mặc định miễn phí cho mọi sản phẩm.
- [FiinQuant](https://fiinquant.vn/), [pricing](https://fiinquant.vn/Pricing),
  [document](https://fiinquant.vn/Home/Document): website công bố sản phẩm/gói,
  trang document công khai chưa cho đủ contract API để tích hợp. Chưa có tài khoản,
  chưa thử API authenticated, chưa xác nhận gói BCTC đầy đủ/giá cụ thể. Chưa mua gói.

Các trạng thái là quan sát trong lần khảo sát, không cam kết endpoint vẫn trả
giống vậy ở lần sau. Việc truy cập được hoặc website quảng bá dữ liệu chính thống
không tự chứng minh độ chính xác toàn bộ, quyền dùng cho ứng dụng hay SLA.

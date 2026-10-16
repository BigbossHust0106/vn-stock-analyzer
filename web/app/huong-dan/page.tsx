import Link from 'next/link';

const sections = [
  ['bat-dau', 'Bắt đầu: đăng nhập và cài trên điện thoại'],
  ['tim-ma', 'Tìm mã và xem chi tiết cổ phiếu'],
  ['top10', 'Top 10 và Bảng tham khảo'],
  ['diem', 'Đọc điểm Graham / Buffett'],
  ['vung-gia', 'Vùng giá, cắt lỗ và kịch bản'],
  ['theo-doi', 'Danh sách theo dõi'],
  ['canh-bao', 'Cảnh báo và thông báo'],
  ['dau-tu-thu', 'Đầu tư thử bằng vốn ảo'],
  ['backtest', 'Lịch sử và backtest'],
  ['cai-dat', 'Cài đặt chấm điểm và rủi ro'],
  ['trang-thai', 'Trạng thái hệ thống'],
  ['du-lieu', 'Nguồn dữ liệu và khi nào “không đủ dữ liệu”'],
] as const;

export default function GuidePage() {
  return (
    <article className="user-guide">
      <p>
        <Link href="/">← Về trang chính</Link>
      </p>
      <span className="eyebrow">HƯỚNG DẪN SỬ DỤNG</span>
      <h1>Dùng VN Stock trong 10 phút</h1>
      <p>
        VN Stock giúp tra cứu và sàng lọc cổ phiếu Việt Nam (HOSE, HNX, UPCOM)
        theo cách nghĩ của Benjamin Graham và Warren Buffett. Mọi con số đều ghi
        nguồn và thời điểm nhận; khi thiếu dữ liệu, trang ghi rõ “không đủ dữ
        liệu” thay vì tự điền số.{' '}
        <strong>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</strong>
      </p>
      <nav aria-label="Mục lục hướng dẫn">
        <ol>
          {sections.map(([id, title]) => (
            <li key={id}>
              <a href={'#' + id}>{title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="bat-dau">
        <h2>1. Bắt đầu: đăng nhập và cài trên điện thoại</h2>
        <ol>
          <li>
            Mở <Link href="/login">trang đăng nhập</Link>. Chọn{' '}
            <em>Đăng ký ngay</em> để tạo tài khoản bằng email và mật khẩu, hoặc{' '}
            <em>Tiếp tục với Google</em> nếu nút này hiển thị.
          </li>
          <li>
            Quên mật khẩu: bấm <em>Quên mật khẩu?</em>, nhập email rồi làm theo
            thư nhận được.
          </li>
          <li>
            Dùng như ứng dụng trên điện thoại: xem{' '}
            <Link href="/install">Cài VN Stock</Link>. Android dùng Chrome →{' '}
            <em>Cài VN Stock</em> hoặc menu → <em>Cài đặt ứng dụng</em>; iPhone
            dùng Safari → <em>Chia sẻ</em> → <em>Thêm vào Màn hình chính</em>.
          </li>
          <li>
            Thanh dưới cùng trên điện thoại có: Tìm mã, Top 10, Theo dõi, Đầu tư
            thử, Cài đặt. Trên máy tính, các mục nằm ở thanh trên cùng; nút
            chuyển chế độ sáng/tối ở góc phải.
          </li>
        </ol>
      </section>

      <section id="tim-ma">
        <h2>2. Tìm mã và xem chi tiết cổ phiếu</h2>
        <ol>
          <li>
            Gõ mã (vd <strong>FPT</strong>) hoặc tên công ty (vd “sữa”) vào ô
            tìm kiếm trên đầu trang, chọn kết quả.
          </li>
          <li>
            Trang chi tiết hiển thị giá gần nhất từ VPS, % thay đổi so với giá
            tham chiếu, khối lượng và <em>thời điểm nhận</em>. Giá tự làm mới
            khoảng 10 giây/lần khi tab đang mở.
          </li>
          <li>
            Bấm <em>Biểu đồ &amp; vùng giá</em> để tải biểu đồ (chỉ tải khi bạn
            bật, giúp tiết kiệm dữ liệu di động).
          </li>
          <li>
            Phần BCTC/điểm cho biết các năm báo cáo đang dùng, nguồn và các tiêu
            chí đạt/không đạt/không đủ dữ liệu. Phần tin tức liệt kê bài liên
            quan kèm link nguồn gốc.
          </li>
          <li>
            Bấm <em>Theo dõi</em> để thêm mã vào danh sách của bạn.
          </li>
        </ol>
      </section>

      <section id="top10">
        <h2>3. Top 10 và Bảng tham khảo</h2>
        <p>
          Vào <Link href="/top10">Top 10</Link>, chọn <em>Kỳ xếp hạng</em>:
        </p>
        <ul>
          <li>
            <strong>Trong ngày</strong>: động lượng giá, khối lượng bất thường,
            kỹ thuật ngắn hạn, lọc chất lượng cơ bản.
          </li>
          <li>
            <strong>Trong tháng</strong>: kỹ thuật trung hạn, định giá, sự kiện
            sắp tới (ĐHĐCĐ, cổ tức…).
          </li>
          <li>
            <strong>Trong quý</strong>: Graham, Buffett và biên an toàn.
          </li>
        </ul>
        <p>
          Lọc thêm theo <em>Sàn</em>, <em>Ngành</em>, <em>Vốn hóa</em>.{' '}
          <em>Trọng số tâm lý tin tức</em> từ 0% (tắt) đến 30%, mặc định 10%.
        </p>
        <p>
          <strong>Top 10 chuẩn</strong> chỉ nhận mã đủ 100% đầu vào của kỳ, có
          giá được xác minh thời điểm phiên. Khi chưa đủ 10 mã, trang hiện thêm{' '}
          <strong>Bảng tham khảo</strong> tách riêng: mã đã có BCTC cơ bản đạt
          lọc (EPS năm, lợi nhuận, vốn chủ dương; vốn hóa ≥100 tỷ; giá ≥1.000đ)
          nhưng còn thiếu một số đầu vào. Cách đọc mỗi dòng:
        </p>
        <ul>
          <li>
            <em>Điểm tổng /100</em> chỉ tính trên phần có dữ liệu; phần thiếu
            không được bù, nên điểm tối đa bằng mức <em>Bao phủ</em>.
          </li>
          <li>
            <em>Tin cậy</em> là mức hoàn thiện bằng chứng, không phải xác suất
            tăng giá.
          </li>
          <li>
            <em>Còn thiếu</em> liệt kê đúng phần dữ liệu chưa có để bạn tự cân
            nhắc.
          </li>
        </ul>
      </section>

      <section id="diem">
        <h2>4. Đọc điểm Graham / Buffett</h2>
        <ul>
          <li>
            <strong>Graham</strong>: P/E &lt; 15 và P/B &lt; 1,5 (hoặc tích &lt;
            22,5); giá thấp hơn Graham Number = √(22,5 × EPS năm × BVPS); thanh
            toán hiện hành &gt; 2; nợ dài hạn thấp hơn vốn lưu động; lợi nhuận
            công ty mẹ dương và có cổ tức 3 năm liên tiếp; biên an toàn ≥ 25%.
          </li>
          <li>
            <strong>Buffett</strong>: ROE &gt; 15% ổn định 3 năm; ROIC &gt; 15%;
            biên gộp &gt; 20%, biên ròng &gt; 10%; nợ vay/vốn chủ &lt; 50%; FCF
            dương và tăng 3 năm; lợi nhuận tăng bền vững; giá thấp hơn DCF ước
            tính với biên an toàn ≥ 25%.
          </li>
          <li>
            Mỗi tiêu chí có trạng thái <em>đạt</em>, <em>không đạt</em> hoặc{' '}
            <em>không đủ dữ liệu</em>. Không đủ dữ liệu không có nghĩa doanh
            nghiệp xấu.
          </li>
          <li>
            Chỉ dùng BCTC <strong>năm</strong>, hợp nhất, đã kiểm toán. Ngân
            hàng, chứng khoán, bảo hiểm chưa được hỗ trợ trong mô hình này.
          </li>
        </ul>
      </section>

      <section id="vung-gia">
        <h2>5. Vùng giá, cắt lỗ và kịch bản</h2>
        <ol>
          <li>
            Trong trang chi tiết mã, mở phần vùng giá &amp; quản lý rủi ro.
          </li>
          <li>
            Chọn cách đặt cắt lỗ: <em>ATR14</em>, <em>Đáy gần nhất</em> hoặc{' '}
            <em>Phần trăm tối đa</em>; chỉnh biên an toàn mua.
          </li>
          <li>
            Trang tính vùng mua, mức chốt lời, mức cắt lỗ, tỷ lệ R:R và làm tròn
            theo bước giá/biên độ sàn. Đây là kịch bản tham khảo.
          </li>
        </ol>
      </section>

      <section id="theo-doi">
        <h2>6. Danh sách theo dõi</h2>
        <ol>
          <li>
            Vào <Link href="/watchlists">Theo dõi</Link> →{' '}
            <em>Tạo danh sách</em>.
          </li>
          <li>
            Thêm mã từ ô tìm kiếm, từ Top 10 hoặc trang chi tiết. Có thể ghi{' '}
            <em>Giá mua mục tiêu</em>.
          </li>
          <li>
            Bảng hiển thị giá mới, điểm hiện tại và điểm lần trước. Danh sách
            được bảo vệ theo tài khoản; người khác không xem được.
          </li>
        </ol>
      </section>

      <section id="canh-bao">
        <h2>7. Cảnh báo và thông báo</h2>
        <ol>
          <li>
            Vào <Link href="/alerts">Cảnh báo</Link> (hoặc chuông thông báo).
          </li>
          <li>
            Chọn mã trong watchlist và loại cảnh báo: chạm vùng mua, chạm mức
            chốt lời, chạm mức cắt lỗ, điểm thay đổi lớn, tin quan trọng.
          </li>
          <li>
            Bấm <em>Lưu quy tắc</em>. Hệ thống kiểm tra khoảng 5 phút/lần; thông
            báo hiện trong chuông. Dùng <em>Gửi cảnh báo thử</em> để kiểm tra.
            Email chỉ hoạt động khi quản trị đã cấu hình dịch vụ gửi thư.
          </li>
        </ol>
      </section>

      <section id="dau-tu-thu">
        <h2>8. Đầu tư thử bằng vốn ảo</h2>
        <ol>
          <li>
            Vào <Link href="/paper">Đầu tư thử</Link>, tạo ví với số vốn ảo bạn
            chọn (tối đa 20 ví/tài khoản).
          </li>
          <li>
            Chọn mã → <em>Lấy giá tham khảo</em> từ VPS → nhập số lượng → mua
            hoặc bán thử. Phí và thuế bán là giả định, ghi rõ trên form.
          </li>
          <li>
            Theo dõi tiền mặt, giá trị cổ phiếu, lãi/lỗ và lịch sử lệnh. Không
            có tiền thật, không gửi lệnh tới công ty chứng khoán.
          </li>
        </ol>
      </section>

      <section id="backtest">
        <h2>9. Lịch sử và backtest</h2>
        <p>
          <Link href="/backtest">Backtest</Link> lưu mỗi lần Top 10 được công bố
          và tính lợi nhuận giá về sau so với thời điểm công bố. Kết quả cần đủ
          thời gian quan sát; đọc mục <em>Quy tắc mô phỏng và giới hạn</em>{' '}
          trước khi diễn giải. Công cụ <em>Kiểm tra biến động giá báo cáo</em>{' '}
          là phần đối chiếu riêng, không phải backtest Top 10.
        </p>
      </section>

      <section id="cai-dat">
        <h2>10. Cài đặt chấm điểm và rủi ro</h2>
        <ul>
          <li>
            <Link href="/settings">Cài đặt</Link>: chỉnh trọng số Graham/Buffett
            (tổng 100%), tăng trưởng, lãi suất chiết khấu, tăng trưởng dài hạn
            và số năm DCF. Tăng trưởng dài hạn phải thấp hơn chiết khấu.
          </li>
          <li>
            Quản trị rủi ro: cắt lỗ tối đa và trailing stop 0,5–30%, hệ số ATR
            0,5–5.
          </li>
          <li>
            Đăng nhập thì cài đặt được lưu theo tài khoản và dùng trên mọi thiết
            bị.
          </li>
        </ul>
      </section>

      <section id="trang-thai">
        <h2>11. Trạng thái hệ thống</h2>
        <p>
          <Link href="/status">Trạng thái</Link> cho biết lần cập nhật thành
          công gần nhất của giá, BCTC (“Dữ liệu cơ bản”), điểm/xếp hạng, tin
          tức, cảnh báo và nhật ký các tác vụ tự động. Nếu một bảng trông cũ,
          hãy xem trang này trước: trạng thái <em>degraded</em> nghĩa là một
          phần nguồn đang lỗi, hệ thống giữ bản tốt gần nhất và tự thử lại.
        </p>
      </section>

      <section id="du-lieu">
        <h2>12. Nguồn dữ liệu và khi nào “không đủ dữ liệu”</h2>
        <ul>
          <li>
            Giá: VPS (bảng giá công khai), làm mới khi trang mở và theo lịch
            trong giờ giao dịch. Đây không phải feed chính thức từng lệnh của
            sàn.
          </li>
          <li>
            BCTC năm: KBS (báo cáo chuẩn hóa) kết hợp Vietcap (số cổ phiếu,
            ROIC; kho báo cáo dự phòng). Hệ thống tự làm mới BCTC mỗi ngày theo
            từng lượt nhỏ, kể cả cuối tuần; nguồn lỗi thì giữ bản cũ.
          </li>
          <li>
            Một số trường hợp vẫn ghi “không đủ dữ liệu”: công ty chỉ công bố
            BCTC riêng lẻ (không có hợp nhất), BCTC quá 550 ngày, nguồn ghi sai
            kỳ báo cáo mà không đối chiếu được, hoặc ngành tài chính.
          </li>
          <li>
            Tin tức lấy từ RSS báo tài chính; điểm tâm lý chỉ có khi đã cấu hình
            mô hình phân tích.
          </li>
        </ul>
        <p>
          <strong>
            Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.
          </strong>
        </p>
      </section>
    </article>
  );
}

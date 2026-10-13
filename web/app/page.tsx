import { StockSearch } from '../ui/stock-search';

export default function Home() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">THỊ TRƯỜNG VIỆT NAM</span>
        <h1>
          Tra cứu cổ phiếu Việt Nam<span>Hiểu giá. Theo dõi thị trường.</span>
        </h1>
        <p>
          Tra cứu doanh nghiệp, giá hiện tại và lịch sử giao dịch.
          <br />
          Một góc nhìn rõ ràng cho mỗi mã cổ phiếu.
        </p>
        <div className="market-labels">
          <span>HOSE</span>
          <span>HNX</span>
          <span>UPCOM</span>
          <span>Giá VPS · Danh mục KBS</span>
        </div>
      </section>
      <StockSearch />
    </>
  );
}

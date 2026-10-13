import { Disclaimer } from '../ui/disclaimer';
import { ConnectionStatus } from '../ui/connection-status';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm font-semibold text-teal-700">HOSE · HNX · UPCOM</p>
      <h1 className="mt-4 text-3xl font-bold">
        Xin chào, thị trường chứng khoán Việt Nam!
      </h1>
      <p className="mt-4">
        Bộ khung ứng dụng đã sẵn sàng. Chưa có dữ liệu thị trường được xác minh.
      </p>
      <Disclaimer />
      <ConnectionStatus />
    </main>
  );
}

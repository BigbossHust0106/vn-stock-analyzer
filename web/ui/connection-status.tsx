'use client';

import { useState } from 'react';
import deployment from '../../config/public-deployment.json';
import { checkConnections, type ConnectionCheck } from '../lib/connections';

export function ConnectionStatus() {
  const [checks, setChecks] = useState<ConnectionCheck[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setChecks(
        await checkConnections({
          workerUrl: process.env.NEXT_PUBLIC_WORKER_URL || deployment.workerUrl,
          ...(process.env.NEXT_PUBLIC_SUPABASE_URL
            ? { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }
            : {}),
          ...(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            ? {
                supabasePublishableKey:
                  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
              }
            : {}),
        }),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-200 p-5">
      <h2 className="text-lg font-semibold">Kết nối nguồn dữ liệu</h2>
      <p className="mt-2 text-sm text-slate-600">
        Kiểm tra khả năng truy cập API và dữ liệu công khai. Kết nối thành công
        không đồng nghĩa dữ liệu giá đã đầy đủ hoặc cập nhật.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={refresh}
        className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
      </button>
      <div aria-live="polite" aria-busy={loading}>
        {checks.length > 0 && (
          <ul className="mt-4 space-y-3">
            {checks.map((check) => (
              <li key={check.name}>
                <span className="font-medium">{check.name}: </span>
                <span className={check.ok ? 'text-teal-800' : 'text-red-700'}>
                  {check.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

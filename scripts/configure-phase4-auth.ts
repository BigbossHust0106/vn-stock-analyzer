import deployment from '../config/public-deployment.json';
async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF,
    token = process.env.SUPABASE_ACCESS_TOKEN;
  if (ref !== new URL(deployment.supabaseUrl).hostname.split('.')[0] || !token)
    throw new Error('Cần đúng project/quyền quản trị Supabase');
  const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  const read = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!read.ok) throw new Error('Không đọc được cấu hình Auth');
  const config = (await read.json()) as {
    uri_allow_list: string;
    external_google_enabled: boolean;
  };
  const current = (config.uri_allow_list || '').split(',').filter(Boolean);
  const callbacks = [
    deployment.workerUrl,
    'http://localhost:3000',
    'http://127.0.0.1:8878',
  ].map((origin) => origin + '/auth/callback**');
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      uri_allow_list: [...new Set([...current, ...callbacks])].join(','),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Không cập nhật được redirect allowlist');
  console.log(
    'AUTH CONFIG PASS: thêm callback production/local, giữ các URL cũ. Google provider:',
    config.external_google_enabled ? 'enabled' : 'chưa cấu hình',
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Auth config thất bại');
  process.exitCode = 1;
});

import { randomUUID, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { defaultSettings } from '../modules/settings/scoring-settings';
async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF,
    token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !token)
    throw new Error(
      'Cần quyền quản trị Supabase để tạo và xóa 2 user kiểm thử tạm thời.',
    );
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error('Không đọc được API key quản trị; không in phản hồi.');
  const keys: unknown = await response.json();
  if (!Array.isArray(keys)) throw new Error('API key metadata không hợp lệ.');
  const key = keys.find(
    (k) => k.name === 'service_role' && typeof k.api_key === 'string',
  )?.api_key as string | undefined;
  if (!key) throw new Error('Không có service_role để kiểm thử Auth.');
  const claims = JSON.parse(
    Buffer.from(key.split('.')[1]!, 'base64url').toString(),
  ) as { role: string; ref: string };
  if (claims.role !== 'service_role' || claims.ref !== ref)
    throw new Error('Credential không đúng project/role.');
  const url = `https://${ref}.supabase.co`,
    options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, key, options),
    created: string[] = [];
  const clients: SupabaseClient[] = [];
  let testError: unknown;
  let cleanupFailed = false;
  try {
    // Credential tạm thời chỉ nằm trong bộ nhớ; finally xóa users và rows bằng cascade.
    for (const label of ['a', 'b']) {
      const email = `codex-scoring-${label}-${randomUUID()}@example.test`,
        password = randomBytes(32).toString('base64url');
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user)
        throw new Error('Không tạo được user Auth tạm thời.');
      created.push(data.user.id);
      const db = createClient(url, key, options);
      const { data: session, error: loginError } =
        await db.auth.signInWithPassword({ email, password });
      if (loginError || session.user?.id !== data.user.id)
        throw new Error('Đăng nhập password tạm thời thất bại.');
      // Các request dữ liệu dùng JWT người dùng, không dùng service-role bearer để kiểm tra RLS.
      const jwt = session.session?.access_token;
      if (!jwt) throw new Error('Thiếu JWT sau login.');
      const publicKey = keys.find(
        (k) => k.name === 'anon' && typeof k.api_key === 'string',
      )?.api_key as string | undefined;
      if (!publicKey)
        throw new Error('Thiếu anon key để kiểm thử JWT người dùng.');
      clients.push(
        createClient(url, publicKey, {
          ...options,
          global: { headers: { Authorization: 'Bearer ' + jwt } },
        }),
      );
    }
    const [a, b] = clients;
    const prefs = { ...defaultSettings, grahamWeight: 70, buffettWeight: 30 };
    const { error } = await b!
      .from('user_settings')
      .upsert({ owner_id: created[1], scoring_preferences: prefs });
    if (error) throw new Error('B không lưu được preferences của mình.');
    const own = await b!
      .from('user_settings')
      .select('scoring_preferences')
      .eq('owner_id', created[1])
      .single();
    if (own.error || own.data.scoring_preferences.grahamWeight !== 70)
      throw new Error('B không đọc được preferences của mình.');
    const other = await a!
      .from('user_settings')
      .select('owner_id,scoring_preferences')
      .eq('owner_id', created[1]);
    if (other.error || other.data.length !== 0)
      throw new Error('A đọc được preferences B hoặc kiểm tra đọc lỗi.');
    const write = await a!
      .from('user_settings')
      .update({ scoring_preferences: defaultSettings })
      .eq('owner_id', created[1])
      .select('owner_id');
    if (write.error || write.data.length !== 0)
      throw new Error('A sửa được preferences B hoặc kiểm tra ghi lỗi.');
    const forge = await a!
      .from('user_settings')
      .upsert({ owner_id: created[1], scoring_preferences: defaultSettings });
    if (!forge.error) throw new Error('A giả mạo được owner B.');
    const saved = await b!
      .from('user_settings')
      .select('scoring_preferences')
      .eq('owner_id', created[1])
      .single();
    if (saved.error || saved.data.scoring_preferences.grahamWeight !== 70)
      throw new Error('Preferences B thay đổi sau phép thử A.');
    console.log(
      'HOSTED SETTINGS PASS: 2 temporary Auth users/password login/JWT; B owns70/30; A cannot read/update/forge B.',
    );
  } catch (error) {
    testError = error;
  } finally {
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.error(
          `Không xóa được user kiểm thử ${id}; xóa tại Supabase Auth.`,
        );
        cleanupFailed = true;
      }
    }
    if (!cleanupFailed)
      console.log(
        `HOSTED SETTINGS CLEANUP PASS: deleted ${created.length} temporary users; preferences cascade removed.`,
      );
  }
  if (testError) throw testError;
  if (cleanupFailed) throw new Error('Cleanup Auth tạm thời thất bại.');
}
main().catch((e) => {
  console.error(
    e instanceof Error ? e.message : 'Hosted settings test thất bại',
  );
  process.exitCode = 1;
});

import { readFile } from 'node:fs/promises';
export async function databaseQuery(
  query: string,
  readOnly = false,
): Promise<unknown> {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !token)
    throw new Error('Thiếu cấu hình quyền quản trị Supabase');
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, read_only: readOnly }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Supabase Management HTTP ${response.status}; không in SQL/payload/credential`,
    );
  return response.json() as Promise<unknown>;
}
export function sqlJson(value: unknown): string {
  return "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
}
export async function migrateHosted(): Promise<void> {
  const { readdir } = await import('node:fs/promises');
  await databaseQuery(
    'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);',
  );
  const applied = await databaseQuery(
    'select version from supabase_migrations.schema_migrations',
    true,
  );
  if (!Array.isArray(applied))
    throw new Error('Migration history không hợp lệ');
  for (const name of (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (!/^\d{12,14}_[a-z0-9_]+\.sql$/.test(name))
      throw new Error('Tên migration không hợp lệ');
    const version = name.split('_')[0]!;
    if (applied.some((row) => row.version === version)) {
      console.log(`HOSTED MIGRATION SKIP: ${name}`);
      continue;
    }
    const sql = await readFile('supabase/migrations/' + name, 'utf8');
    const body = sql.replace(/^begin;\s*/, '').replace(/commit;\s*$/, '');
    await databaseQuery(
      `begin; ${body} insert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array[]::text[]); commit;`,
    );
    console.log(`HOSTED MIGRATION PASS: ${name}`);
  }
  await databaseQuery("notify pgrst, 'reload schema';");
}

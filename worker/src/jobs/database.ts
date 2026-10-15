import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
export function serviceDatabase(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Thiếu quyền tác vụ');
  return createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

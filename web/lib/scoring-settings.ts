import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  defaultSettings,
  validateSettings,
  type ScoringSettings,
} from '../../modules/settings/scoring-settings';
import deployment from '../../config/public-deployment.json';
const activeKey = 'vn-stock-scoring-owner';
function storageKey() {
  const owner = localStorage.getItem(activeKey);
  return 'vn-stock-scoring-v1:' + (owner || 'guest');
}
export function setSettingsOwner(owner: string | null): void {
  if (owner) localStorage.setItem(activeKey, owner);
  else localStorage.removeItem(activeKey);
}
export function readSettings(): ScoringSettings {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey()) ?? 'null',
    );
    return validateSettings(value) ? value : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}
export function writeSettings(settings: ScoringSettings): void {
  if (!validateSettings(settings))
    throw new Error('Trọng số/giả định không hợp lệ.');
  localStorage.setItem(storageKey(), JSON.stringify(settings));
  window.dispatchEvent(new Event('scoring-settings-changed'));
}
let client: Promise<SupabaseClient> | null = null;
export function settingsClient(): Promise<SupabaseClient> {
  if (client) return client;
  client = (async () => {
    const base = process.env.NEXT_PUBLIC_WORKER_URL || deployment.workerUrl;
    const response = await fetch(new URL('/v1/public-config', base), {
      signal: AbortSignal.timeout(10000),
    });
    const config = (await response.json()) as {
      supabaseUrl: string;
      supabasePublishableKey: string;
    };
    if (
      !response.ok ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)
    )
      throw new Error('Cấu hình Supabase công khai chưa sẵn sàng.');
    return createClient(config.supabaseUrl, config.supabasePublishableKey);
  })().catch((e) => {
    client = null;
    throw e;
  });
  return client;
}

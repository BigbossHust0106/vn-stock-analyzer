'use client';
import {
  createClient,
  type SupabaseClient,
  type Session,
} from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';
import {
  defaultSettings,
  type ScoringSettings,
} from '../../modules/settings/scoring-settings';
import { SessionPreferences } from '../../modules/settings/session-preferences';
import deployment from '../../config/public-deployment.json';
const listeners = new Set<() => void>();
function changed() {
  for (const listener of listeners) listener();
}
let preferences: SessionPreferences | null = null;
let authGeneration = 0;
function store() {
  if (!preferences) {
    let storage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
    try {
      storage = localStorage;
    } catch {
      const values = new Map<string, string>();
      storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
      };
    }
    preferences = new SessionPreferences(storage, changed);
  }
  return preferences;
}
interface AuthView {
  ready: boolean;
  ownerId: string | null;
  message: string;
}
const serverView: AuthView = { ready: false, ownerId: null, message: '' };
let view: AuthView = serverView;
let started: Promise<void> | null = null,
  expiry: ReturnType<typeof setTimeout> | null = null;
let client: Promise<SupabaseClient> | null = null;
export function settingsClient(): Promise<SupabaseClient> {
  if (client) return client;
  client = (async () => {
    const base =
      process.env.NEXT_PUBLIC_WORKER_URL ||
      (typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? window.location.origin
        : deployment.workerUrl);
    const response = await fetch(new URL('/v1/public-config', base), {
      signal: AbortSignal.timeout(10000),
    });
    const config = (await response.json()) as {
      supabaseUrl: string;
      supabasePublishableKey: string;
    };
    if (
      !response.ok ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey) ||
      !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl)
    )
      throw new Error('Cấu hình Supabase công khai chưa sẵn sàng.');
    return createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: false },
    });
  })().catch((e) => {
    client = null;
    throw e;
  });
  return client;
}

export async function googleAuthEnabled(): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_WORKER_URL || deployment.workerUrl;
  const configResponse = await fetch(new URL('/v1/public-config', base), {
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  const config = (await configResponse.json()) as {
    supabaseUrl: string;
    supabasePublishableKey: string;
  };
  if (
    !configResponse.ok ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)
  )
    throw new Error('Chưa kiểm tra được đăng nhập Google.');
  const response = await fetch(
    new URL('/auth/v1/settings', config.supabaseUrl),
    {
      headers: { apikey: config.supabasePublishableKey },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Chưa kiểm tra được đăng nhập Google.');
  const settings = (await response.json()) as {
    external?: { google?: boolean };
  };
  return settings.external?.google === true;
}
function publishOwner() {
  view = { ...view, ready: true, ownerId: store().ownerId() };
  changed();
}
async function applySession(session: Session | null, db: SupabaseClient) {
  const owner = session?.user.id ?? null,
    deadline = session?.expires_at ? session.expires_at * 1000 : null;
  store().activate(owner, deadline);
  publishOwner();
  if (expiry) clearTimeout(expiry);
  if (deadline !== null && deadline > Date.now())
    expiry = setTimeout(
      () => {
        store().activate(null, null);
        publishOwner();
      },
      Math.min(deadline - Date.now() + 1, 2147483647),
    );
  const request = store().capture();
  if (request.owner) {
    const { data, error } = await db
      .from('user_settings')
      .select('scoring_preferences')
      .eq('owner_id', request.owner)
      .maybeSingle();
    if (!error) {
      store().accept(data?.scoring_preferences ?? defaultSettings, request);
    }
  }
}
export function initializeSettings(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      const db = await settingsClient();
      const refreshFromStorage = async () => {
        const generation = authGeneration;
        const { data, error } = await db.auth.getSession();
        if (generation === authGeneration)
          await applySession(error ? null : data.session, db);
      };
      db.auth.onAuthStateChange((_event, session) => {
        const generation = ++authGeneration;
        queueMicrotask(() => {
          if (generation === authGeneration) void applySession(session, db);
        });
      });
      await refreshFromStorage();
      window.addEventListener('storage', () => {
        changed();
        void refreshFromStorage();
      });
    } catch {
      store().activate(null, null);
      view = {
        ready: true,
        ownerId: null,
        message:
          'Cài đặt trình duyệt vẫn dùng được; chưa kết nối Supabase Auth.',
      };
      changed();
    }
  })();
  return started;
}
export function readSettings(): ScoringSettings {
  return typeof window === 'undefined'
    ? { ...defaultSettings }
    : store().read();
}
export function writeSettings(
  settings: ScoringSettings,
  expectedOwner: string | null = store().ownerId(),
): void {
  store().write(settings, expectedOwner);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useSettingsAuth() {
  useEffect(() => {
    void initializeSettings();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => {
      const owner = store().ownerId();
      if (view.ownerId !== owner) view = { ...view, ownerId: owner };
      return view;
    },
    () => serverView,
  );
}
const defaultSnapshot = JSON.stringify(defaultSettings);
export function useScoringSettings() {
  useSettingsAuth();
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readSettings()),
    () => defaultSnapshot,
  );
  return JSON.parse(snapshot) as ScoringSettings;
}

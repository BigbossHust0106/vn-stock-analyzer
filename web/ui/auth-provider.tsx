'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import {
  settingsClient,
  setSettingsOwner,
  writeSettings,
  readSettings,
} from '../lib/scoring-settings';
import {
  defaultSettings,
  validateSettings,
} from '../../modules/settings/scoring-settings';
const AuthContext = createContext<{
  user: User | null;
  ready: boolean;
  error: string;
}>({ user: null, ready: false, error: '' });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    user: User | null;
    ready: boolean;
    error: string;
  }>({ user: null, ready: false, error: '' });
  useEffect(() => {
    let disposed = false,
      unsub: (() => void) | undefined,
      version = 0;
    const update = async () => {
      const current = ++version;
      try {
        const db = await settingsClient();
        const { data, error } = await db.auth.getUser();
        const user = error ? null : data.user;
        if (disposed || current !== version) return;
        setSettingsOwner(user?.id ?? null);
        if (user) {
          const { data: row, error: readError } = await db
            .from('user_settings')
            .select('scoring_preferences')
            .eq('owner_id', user.id)
            .maybeSingle();
          if (disposed || current !== version) return;
          writeSettings(
            !readError && validateSettings(row?.scoring_preferences)
              ? row.scoring_preferences
              : { ...defaultSettings },
          );
        } else writeSettings(readSettings());
        setState({ user, ready: true, error: '' });
      } catch {
        if (!disposed && current === version)
          setState({
            user: null,
            ready: true,
            error: 'Không kết nối được dịch vụ đăng nhập.',
          });
      }
    };
    void settingsClient()
      .then((db) => {
        if (disposed) return;
        // Không await Supabase trong callback: tránh deadlock khóa refresh token.
        const { data } = db.auth.onAuthStateChange(() => {
          window.setTimeout(() => void update(), 0);
        });
        unsub = () => data.subscription.unsubscribe();
        void update();
      })
      .catch(() => {
        if (!disposed)
          setState({
            user: null,
            ready: true,
            error: 'Không kết nối được dịch vụ đăng nhập.',
          });
      });
    return () => {
      disposed = true;
      version++;
      unsub?.();
    };
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  return useContext(AuthContext);
}

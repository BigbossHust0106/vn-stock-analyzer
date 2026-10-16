'use client';
import { useEffect, useState } from 'react';
import {
  defaultRiskSettings,
  validRiskSettings,
  type RiskSettings,
} from '../../modules/settings/risk-settings';
import { settingsClient } from './scoring-settings';
export function useAccountRisk(owner: string | null) {
  const [loaded, setLoaded] = useState<{
      owner: string;
      value: RiskSettings;
    } | null>(null),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    if (owner)
      void settingsClient()
        .then((db) =>
          db
            .from('user_settings')
            .select('risk_preferences')
            .eq('owner_id', owner)
            .maybeSingle(),
        )
        .then(({ data, error }) => {
          if (!active) return;
          if (error) {
            setMessage('Chưa tải được ngưỡng rủi ro; đang dùng mặc định.');
            return;
          }
          setLoaded({
            owner,
            value: validRiskSettings(data?.risk_preferences)
              ? data.risk_preferences
              : defaultRiskSettings,
          });
        })
        .catch(() => {
          if (active)
            setMessage('Chưa tải được ngưỡng rủi ro; đang dùng mặc định.');
        });
    return () => {
      active = false;
    };
  }, [owner]);
  return {
    value:
      owner && loaded?.owner === owner ? loaded.value : defaultRiskSettings,
    ready: !!owner && loaded?.owner === owner,
    message,
  };
}

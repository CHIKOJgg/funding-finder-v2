import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';
import { ALL_EXCHANGES } from '../utils/exchanges';
import { ExchangeSelector } from '../components/ExchangeSelector';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useT } from '../i18n';

interface UserSettings {
  telegramNotifications: boolean;
  emailNotifications: boolean;
  emailAddress: string;
  dailySummary: boolean;
  alertSound: boolean;
  spreadNotifications: boolean;
  spreadMinThreshold: number;
  defaultExchanges: string[];
  theme: 'auto' | 'light' | 'dark';
  language: string;
  timezone: string;
  minVolumeFilter: number;
  minRateFilter: number;
}

const DEFAULT_SETTINGS: UserSettings = {
  telegramNotifications: true,
  emailNotifications: false,
  emailAddress: '',
  dailySummary: true,
  alertSound: true,
  spreadNotifications: false,
  spreadMinThreshold: 0.002,
  defaultExchanges: ALL_EXCHANGES,
  theme: 'auto',
  language: 'ru',
  timezone: 'Europe/Moscow',
  minVolumeFilter: 1000,
  minRateFilter: 0,
};

export function SettingsPage() {
  const { showToast } = useToast();
  const t = useT();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res: any = await apiClient.getSettings();
      if (res.ok && res.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...res.settings });
      }
    } catch {
      showToast(t('settings.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res: any = await apiClient.updateSettings(settings);
      if (res.ok) {
        showToast(t('settings.saved'), 'success');
      } else {
        showToast(t('settings.saveError'), 'error');
      }
    } catch {
      showToast(t('settings.networkError'), 'error');
    } finally {
      setSaving(false);
    }
  }, [settings, showToast]);

  const handleReset = useCallback(async () => {
    try {
      const res: any = await apiClient.resetSettings();
      if (res.ok) {
        setSettings(DEFAULT_SETTINGS);
        showToast(t('settings.resetDone'), 'success');
      }
    } catch {
      showToast(t('settings.resetError'), 'error');
    }
  }, [showToast]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="card text-center py-8 text-gray-500" role="status">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="card">
          <h1 className="text-xl font-bold mb-2">{t('settings.title')}</h1>
          <p className="text-sm text-gray-600 mb-4">{t('settings.subtitle')}</p>
      </div>

      <div className="card">
          <h2 className="text-lg font-semibold mb-3">{t('settings.notifications')}</h2>

        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm">{t('settings.telegram')}</span>
            <input
              type="checkbox"
              checked={settings.telegramNotifications}
              onChange={(e) => setSettings((prev) => ({ ...prev, telegramNotifications: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-sm">{t('settings.email')}</span>
            <input
              type="checkbox"
              checked={settings.emailNotifications}
              onChange={(e) => setSettings((prev) => ({ ...prev, emailNotifications: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          {settings.emailNotifications && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email-address">
                {t('settings.emailAddress')}
              </label>
              <input
                id="email-address"
                type="email"
                value={settings.emailAddress}
                onChange={(e) => setSettings((prev) => ({ ...prev, emailAddress: e.target.value }))}
                className="input-field"
                placeholder="user@example.com"
              />
            </div>
          )}

          <label className="flex items-center justify-between">
            <span className="text-sm">{t('settings.dailySummary')}</span>
            <input
              type="checkbox"
              checked={settings.dailySummary}
              onChange={(e) => setSettings((prev) => ({ ...prev, dailySummary: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-sm">{t('settings.alertSound')}</span>
            <input
              type="checkbox"
              checked={settings.alertSound}
              onChange={(e) => setSettings((prev) => ({ ...prev, alertSound: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-sm">{t('settings.spreadPush')}</span>
            <input
              type="checkbox"
              checked={settings.spreadNotifications}
              onChange={(e) => setSettings((prev) => ({ ...prev, spreadNotifications: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          {settings.spreadNotifications && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="spread-threshold">
                {t('settings.spreadThreshold')}
              </label>
              <input
                id="spread-threshold"
                type="number"
                value={Number((settings.spreadMinThreshold * 100).toFixed(4))}
                onChange={(e) => setSettings((prev) => ({ ...prev, spreadMinThreshold: (Number(e.target.value) || 0) / 100 }))}
                step={0.01}
                min={0}
                className="input-field"
              />
              <p className="text-xs text-gray-500 mt-1">{t('settings.spreadThresholdHint')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <ExchangeSelector
          value={settings.defaultExchanges}
          onChange={(next) => setSettings((prev) => ({ ...prev, defaultExchanges: next }))}
          title={t('settings.defaultExchanges')}
        />
      </div>

      <div className="card">
          <h2 className="text-lg font-semibold mb-3">{t('settings.filters')}</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="min-volume">
                {t('settings.minVolume')}
            </label>
            <input
              id="min-volume"
              type="number"
              value={settings.minVolumeFilter}
              onChange={(e) => setSettings((prev) => ({ ...prev, minVolumeFilter: Number(e.target.value) || 0 }))}
              min={0}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="min-rate">
                {t('settings.minRate')}
            </label>
            <input
              id="min-rate"
              type="number"
              value={settings.minRateFilter}
              onChange={(e) => setSettings((prev) => ({ ...prev, minRateFilter: Number(e.target.value) || 0 }))}
              step={0.001}
              min={0}
              className="input-field"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">{t('settings.language')}</h2>
        <LanguageSwitcher
          onChange={(l) => setSettings((prev) => ({ ...prev, language: l }))}
        />
      </div>

      <div className="card">
          <h2 className="text-lg font-semibold mb-3">{t('settings.appearance')}</h2>

        <div className="space-y-3">
          <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.theme')}</label>
            <select
              value={settings.theme}
              onChange={(e) => setSettings((prev) => ({ ...prev, theme: e.target.value as 'auto' | 'light' | 'dark' }))}
              className="input-field"
            >
              <option value="auto">{t('settings.themeAuto')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
            </select>
          </div>

          <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.timezone')}</label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
              className="input-field"
            >
              <option value="Europe/Moscow">{t('settings.tzMsk')}</option>
              <option value="Europe/Kaliningrad">{t('settings.tzKaliningrad')}</option>
              <option value="Europe/Samara">{t('settings.tzSamara')}</option>
              <option value="Asia/Yekaterinburg">{t('settings.tzYekaterinburg')}</option>
              <option value="Asia/Omsk">{t('settings.tzOmsk')}</option>
              <option value="Asia/Krasnoyarsk">{t('settings.tzKrasnoyarsk')}</option>
              <option value="Asia/Irkutsk">{t('settings.tzIrkutsk')}</option>
              <option value="Asia/Vladivostok">{t('settings.tzVladivostok')}</option>
              <option value="Asia/Kamchatka">{t('settings.tzKamchatka')}</option>
              <option value="UTC">{t('settings.tzUtc')}</option>
              <option value="Europe/London">{t('settings.tzLondon')}</option>
              <option value="America/New_York">{t('settings.tzNewYork')}</option>
              <option value="America/Chicago">{t('settings.tzChicago')}</option>
              <option value="America/Los_Angeles">{t('settings.tzLa')}</option>
              <option value="Asia/Shanghai">{t('settings.tzShanghai')}</option>
              <option value="Asia/Tokyo">{t('settings.tzTokyo')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary flex-1">
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
          <button onClick={handleReset} className="btn btn-secondary flex-1">
            {t('common.reset')}
          </button>
      </div>
    </div>
  );
}


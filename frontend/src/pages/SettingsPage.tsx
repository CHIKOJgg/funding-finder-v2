import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';
import { ALL_EXCHANGES } from '../utils/exchanges';
import { ExchangeSelector } from '../components/ExchangeSelector';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useT } from '../i18n';
import { clsx } from 'clsx';
import { CardSkeleton } from '../components/Skeleton';

interface UserSettings {
  telegramNotifications: boolean;
  emailNotifications: boolean;
  emailAddress: string;
  dailySummary: boolean;
  alertSound: boolean;
  spreadNotifications: boolean;
  spreadMinThreshold: number;
  pushoverNotifications: boolean;
  pushoverKey: string;
  pushoverDevice: string;
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
  pushoverNotifications: false,
  pushoverKey: '',
  pushoverDevice: '',
  defaultExchanges: ALL_EXCHANGES,
  theme: 'auto',
  language: 'ru',
  timezone: 'Europe/Moscow',
  minVolumeFilter: 1000,
  minRateFilter: 0,
};

function AccordionSection({
  title,
  icon,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-lg font-semibold">{title}</span>
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              {badge}
            </span>
          )}
        </span>
        <span
          className={clsx(
            'text-sm transition-transform duration-200',
            open ? 'rotate-180' : ''
          )}
        >
          ▾
        </span>
      </button>
      {open && <div className="pb-3 border-t border-gray-100 dark:border-gray-800 pt-3">{children}</div>}
    </div>
  );
}

function NotificationPreview({
  settings,
}: {
  settings: UserSettings;
}) {
  const t = useT();
  const enabledCount = [
    settings.telegramNotifications,
    settings.emailNotifications,
    settings.pushoverNotifications,
  ].filter(Boolean).length;

  const features = [
    { key: 'telegram', enabled: settings.telegramNotifications, label: 'Telegram' },
    { key: 'email', enabled: settings.emailNotifications, label: 'Email' },
    { key: 'pushover', enabled: settings.pushoverNotifications, label: 'Pushover' },
  ];

  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface-2)' }}>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
        {enabledCount > 0
          ? t('settings.channelsActive', { count: enabledCount })
          : t('settings.noChannelsActive')}
      </p>
      <div className="flex gap-2">
        {features.map((f) => (
          <span
            key={f.key}
            className={clsx(
              'text-xs px-2 py-1 rounded-full',
              f.enabled
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            )}
          >
            {f.enabled ? '●' : '○'} {f.label}
          </span>
        ))}
      </div>
      {settings.dailySummary && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          {t('settings.dailySummaryTime')}
        </p>
      )}
      {settings.spreadNotifications && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('settings.spreadAlertHint', { threshold: (settings.spreadMinThreshold * 100).toFixed(2) })}
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { showToast } = useToast();
  const t = useT();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleExport = useCallback(() => {
    const data = JSON.stringify(settings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `funding-finder-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('settings.exportDone'), 'success');
  }, [settings, showToast]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result as string) as Partial<UserSettings>;
          setSettings((prev) => ({ ...prev, ...imported }));
          showToast(t('settings.importDone'), 'success');
        } catch {
          showToast(t('settings.importError'), 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [showToast]
  );

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="px-3 py-4 sm:px-4 sm:max-w-2xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-2 text-[var(--text)]">{t('settings.title')}</h1>
        <p className="text-sm text-gray-600 mb-0">{t('settings.subtitle')}</p>
      </div>

      <NotificationPreview settings={settings} />

      <AccordionSection title={t('settings.notifications')} icon="🔔" defaultOpen badge={`${[settings.telegramNotifications, settings.emailNotifications, settings.pushoverNotifications].filter(Boolean).length}`}>
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
      </AccordionSection>

      <AccordionSection title={t('settings.pushover')} icon="📱" defaultOpen={false}>
        <p className="text-xs text-gray-500 mb-3">{t('settings.pushoverHint')}</p>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm">{t('settings.pushoverEnable')}</span>
            <input
              type="checkbox"
              checked={settings.pushoverNotifications}
              onChange={(e) => setSettings((prev) => ({ ...prev, pushoverNotifications: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          {settings.pushoverNotifications && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="pushover-key">
                  {t('settings.pushoverKey')}
                </label>
                <input
                  id="pushover-key"
                  type="text"
                  value={settings.pushoverKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, pushoverKey: e.target.value }))}
                  placeholder="uQiPBb1Rgc..."
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="pushover-device">
                  {t('settings.pushoverDevice')}
                </label>
                <input
                  id="pushover-device"
                  type="text"
                  value={settings.pushoverDevice}
                  onChange={(e) => setSettings((prev) => ({ ...prev, pushoverDevice: e.target.value }))}
                  placeholder={t('settings.pushoverDevicePlaceholder')}
                  className="input-field"
                />
              </div>
            </>
          )}
        </div>
      </AccordionSection>

      <AccordionSection title={t('settings.defaultExchanges')} icon="🏦" defaultOpen={false}>
        <ExchangeSelector
          value={settings.defaultExchanges}
          onChange={(next) => setSettings((prev) => ({ ...prev, defaultExchanges: next }))}
          title={t('settings.defaultExchanges')}
        />
      </AccordionSection>

      <AccordionSection title={t('settings.filters')} icon="🔍" defaultOpen={false}>
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
      </AccordionSection>

      <AccordionSection title={t('settings.language')} icon="🌐" defaultOpen={false}>
        <LanguageSwitcher
          onChange={(l) => setSettings((prev) => ({ ...prev, language: l }))}
        />
      </AccordionSection>

      <AccordionSection title={t('settings.appearance')} icon="🎨" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-theme">{t('settings.theme')}</label>
            <select
              id="settings-theme"
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
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-timezone">{t('settings.timezone')}</label>
            <select
              id="settings-timezone"
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
      </AccordionSection>

      <AccordionSection title={t('settings.exportImport')} icon="📦" defaultOpen={false}>
        <p className="text-xs text-gray-500 mb-3">{t('settings.exportImportHint')}</p>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn btn-secondary flex-1 text-sm">
            {t('settings.export')}
          </button>
          <button onClick={handleImport} className="btn btn-secondary flex-1 text-sm">
            {t('settings.import')}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </AccordionSection>

      <div className="flex gap-2 mt-2">
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

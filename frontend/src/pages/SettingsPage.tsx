import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';
import { ALL_EXCHANGES } from '../utils/exchanges';
import { ExchangeSelector } from '../components/ExchangeSelector';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useT } from '../i18n';
import { clsx } from 'clsx';
import { CardSkeleton } from '../components/Skeleton';
import { Icon, IconCheck, IconChevronDown, type IconName } from '../components/icons';

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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="w-11 h-11 flex items-center justify-center rounded-lg"
    >
      <span
        className="relative inline-block rounded-full"
        style={{
          width: 40,
          height: 22,
          background: checked ? 'var(--cobalt)' : 'var(--surface-2)',
          border: '1px solid var(--border-2)',
          transition: 'background .15s ease',
        }}
      >
        <span
          className="absolute top-1/2 rounded-full"
          style={{
            left: checked ? 20 : 2,
            width: 16,
            height: 16,
            background: checked ? 'var(--on-brand)' : 'var(--text3)',
            transition: 'left .15s ease',
            transform: 'translateY(-50%)',
          }}
        />
      </span>
    </button>
  );
}

function AccordionSection({
  title,
  icon,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  icon: IconName;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={clsx('card', !open && 'overflow-hidden')}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 text-left min-h-[52px]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon name={icon} size={18} className="shrink-0" style={{ color: 'var(--cobalt-text)' }} />
          <span className="text-lg font-semibold">{title}</span>
          {badge && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
            >
              {badge}
            </span>
          )}
        </span>
        <IconChevronDown
          size={16}
          className={clsx('shrink-0 transition-transform duration-200', open ? 'rotate-180' : '')}
          style={{ color: 'var(--text3)' }}
        />
      </button>
      {open && <div className="pb-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>{children}</div>}
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
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
            style={
              f.enabled
                ? { background: 'var(--green-soft)', color: 'var(--green)' }
                : { background: 'var(--surface-2)', color: 'var(--text3)' }
            }
          >
            {f.enabled ? (
              <IconCheck size={11} className="shrink-0" />
            ) : (
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: 'var(--text3)' }} />
            )}
            {f.label}
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

let memorySettingsCache: UserSettings | null = null;

export function SettingsPage() {
  const { showToast } = useToast();
  const t = useT();
  const [settings, setSettings] = useState<UserSettings>(() => memorySettingsCache || DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(() => !memorySettingsCache);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings(!memorySettingsCache);
  }, []);

  const loadSettings = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res: any = await apiClient.getSettings();
      if (res?.ok && res.settings) {
        const merged = { ...DEFAULT_SETTINGS, ...res.settings };
        setSettings(merged);
        memorySettingsCache = merged;
      }
    } catch {
      if (!memorySettingsCache) {
        showToast(t('settings.loadError'), 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    memorySettingsCache = { ...settings };
    try {
      const res: any = await apiClient.updateSettings(settings);
      if (res?.ok) {
        showToast(t('settings.saved'), 'success');
      } else {
        showToast(t('settings.saveError'), 'error');
      }
    } catch {
      showToast(t('settings.networkError'), 'error');
    } finally {
      setSaving(false);
    }
  }, [settings, showToast, t]);

  const handleReset = useCallback(async () => {
    try {
      const res: any = await apiClient.resetSettings();
      if (res?.ok) {
        setSettings(DEFAULT_SETTINGS);
        memorySettingsCache = DEFAULT_SETTINGS;
        showToast(t('settings.resetDone'), 'success');
      }
    } catch {
      showToast(t('settings.resetError'), 'error');
    }
  }, [showToast, t]);

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
    <div className="px-3 py-4 sm:px-4 sm:max-w-2xl mx-auto pb-24">
      <div className="card">
        <h1 className="text-xl font-bold mb-2 text-[var(--text)]">{t('settings.title')}</h1>
        <p className="text-sm mb-0" style={{ color: 'var(--text2)' }}>{t('settings.subtitle')}</p>
      </div>

      <NotificationPreview settings={settings} />

      <AccordionSection title={t('settings.notifications')} icon="Bell" defaultOpen badge={`${[settings.telegramNotifications, settings.emailNotifications, settings.pushoverNotifications].filter(Boolean).length}`}>
        <div className="space-y-3">
          <label className="flex items-center justify-between min-h-[44px]">
            <span className="text-sm">{t('settings.telegram')}</span>
            <Toggle
              checked={settings.telegramNotifications}
              onChange={(v) => setSettings((prev) => ({ ...prev, telegramNotifications: v }))}
              label={t('settings.telegram')}
            />
          </label>

          <label className="flex items-center justify-between min-h-[44px]">
            <span className="text-sm">{t('settings.email')}</span>
            <Toggle
              checked={settings.emailNotifications}
              onChange={(v) => setSettings((prev) => ({ ...prev, emailNotifications: v }))}
              label={t('settings.email')}
            />
          </label>

          {settings.emailNotifications && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="email-address">
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

          <label className="flex items-center justify-between min-h-[44px]">
            <span className="text-sm">{t('settings.dailySummary')}</span>
            <Toggle
              checked={settings.dailySummary}
              onChange={(v) => setSettings((prev) => ({ ...prev, dailySummary: v }))}
              label={t('settings.dailySummary')}
            />
          </label>

          <label className="flex items-center justify-between min-h-[44px]">
            <span className="text-sm">{t('settings.alertSound')}</span>
            <Toggle
              checked={settings.alertSound}
              onChange={(v) => setSettings((prev) => ({ ...prev, alertSound: v }))}
              label={t('settings.alertSound')}
            />
          </label>

          <label className="flex items-center justify-between min-h-[44px]">
            <span className="text-sm">{t('settings.spreadPush')}</span>
            <Toggle
              checked={settings.spreadNotifications}
              onChange={(v) => setSettings((prev) => ({ ...prev, spreadNotifications: v }))}
              label={t('settings.spreadPush')}
            />
          </label>

          {settings.spreadNotifications && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="spread-threshold">
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
              <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{t('settings.spreadThresholdHint')}</p>
            </div>
          )}
        </div>
      </AccordionSection>

      <AccordionSection title={t('settings.pushover')} icon="Smartphone" defaultOpen={false}>
        <p className="text-xs mb-3" style={{ color: 'var(--text3)' }}>{t('settings.pushoverHint')}</p>
        <div className="space-y-3">
          <label className="flex items-center justify-between min-h-[44px]">
            <span className="text-sm">{t('settings.pushoverEnable')}</span>
            <Toggle
              checked={settings.pushoverNotifications}
              onChange={(v) => setSettings((prev) => ({ ...prev, pushoverNotifications: v }))}
              label={t('settings.pushoverEnable')}
            />
          </label>

          {settings.pushoverNotifications && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="pushover-key">
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
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="pushover-device">
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

      <AccordionSection title={t('settings.defaultExchanges')} icon="Wallet" defaultOpen={false}>
        <ExchangeSelector
          value={settings.defaultExchanges}
          onChange={(next) => setSettings((prev) => ({ ...prev, defaultExchanges: next }))}
          title={t('settings.defaultExchanges')}
        />
      </AccordionSection>

      <AccordionSection title={t('settings.filters')} icon="Search" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="min-volume">
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
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="min-rate">
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

      <AccordionSection title={t('settings.language')} icon="Globe" defaultOpen={false}>
        <LanguageSwitcher
          variant="pills"
          onChange={(l) => setSettings((prev) => ({ ...prev, language: l }))}
        />
      </AccordionSection>

      <AccordionSection title={t('settings.appearance')} icon="Palette" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text2)' }} htmlFor="settings-timezone">{t('settings.timezone')}</label>
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
          <p className="text-xs" style={{ color: 'var(--text3)' }}>{t('settings.themeFixed')}</p>
        </div>
      </AccordionSection>

      <AccordionSection title={t('settings.exportImport')} icon="Package" defaultOpen={false}>
        <p className="text-xs mb-3" style={{ color: 'var(--text3)' }}>{t('settings.exportImportHint')}</p>
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

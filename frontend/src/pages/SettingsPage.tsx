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
    <div className="card overflow-hidden">
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
        {features.map((f) => (\n          <span\n            key={f.key}\n            className=\"inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium\"\n            style={\n              f.enabled\n                ? { background: 'var(--green-soft)', color: 'var(--green)' }\n                : { background: 'var(--surface-2)', color: 'var(--text3)' }\n            }\n          >\n            {f.enabled ? (\n              <IconCheck size={11} className=\"shrink-0\" />\n            ) : (\n              <span className=\"w-[7px] h-[7px] rounded-full shrink-0\" style={{ background: 'var(--text3)' }} />\n            )}\n            {f.label}\n          </span>\n        ))}\n      </div>\n      {settings.dailySummary && (\n        <p className=\"text-xs mt-2\" style={{ color: 'var(--text-muted)' }}>\n          {t('settings.dailySummaryTime')}\n        </p>\n      )}\n      {settings.spreadNotifications && (\n        <p className=\"text-xs mt-1\" style={{ color: 'var(--text-muted)' }}>\n          {t('settings.spreadAlertHint', { threshold: (settings.spreadMinThreshold * 100).toFixed(2) })}\n        </p>\n      )}\n    </div>\n  );\n}\n\nlet memorySettingsCache: UserSettings | null = null;\n\nexport function SettingsPage() {\n  const { showToast } = useToast();\n  const t = useT();\n  const [settings, setSettings] = useState<UserSettings>(() => memorySettingsCache || DEFAULT_SETTINGS);\n  const [loading, setLoading] = useState(() => !memorySettingsCache);\n  const [saving, setSaving] = useState(false);\n  const fileInputRef = useRef<HTMLInputElement>(null);\n\n  useEffect(() => {\n    loadSettings(!memorySettingsCache);\n  }, []);\n\n  const loadSettings = async (showLoading = false) => {\n    try {\n      if (showLoading) setLoading(true);\n      const res: any = await apiClient.getSettings();\n      if (res?.ok && res.settings) {\n        const merged = { ...DEFAULT_SETTINGS, ...res.settings };\n        setSettings(merged);\n        memorySettingsCache = merged;\n      }\n    } catch {\n      if (!memorySettingsCache) {\n        showToast(t('settings.loadError'), 'error');\n      }\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  const handleSave = useCallback(async () => {\n    setSaving(true);\n    memorySettingsCache = { ...settings };\n    try {\n      const res: any = await apiClient.updateSettings(settings);\n      if (res?.ok) {\n        showToast(t('settings.saved'), 'success');\n      } else {\n        showToast(t('settings.saveError'), 'error');\n      }\n    } catch {\n      showToast(t('settings.networkError'), 'error');\n    } finally {\n      setSaving(false);\n    }\n  }, [settings, showToast, t]);\n\n  const handleReset = useCallback(async () => {\n    try {\n      const res: any = await apiClient.resetSettings();\n      if (res?.ok) {\n        setSettings(DEFAULT_SETTINGS);\n        memorySettingsCache = DEFAULT_SETTINGS;\n        showToast(t('settings.resetDone'), 'success');\n      }\n    } catch {\n      showToast(t('settings.resetError'), 'error');\n    }\n  }, [showToast, t]);\n\n  const handleExport = useCallback(() => {\n    const data = JSON.stringify(settings, null, 2);\n    const blob = new Blob([data], { type: 'application/json' });\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url;\n    a.download = `funding-finder-settings-${new Date().toISOString().slice(0, 10)}.json`;\n    a.click();\n    URL.revokeObjectURL(url);\n    showToast(t('settings.exportDone'), 'success');\n  }, [settings, showToast]);\n\n  const handleImport = useCallback(() => {\n    fileInputRef.current?.click();\n  }, []);\n\n  const handleFileChange = useCallback(\n    (e: React.ChangeEvent<HTMLInputElement>) => {\n      const file = e.target.files?.[0];\n      if (!file) return;\n      const reader = new FileReader();\n      reader.onload = () => {\n        try {\n          const imported = JSON.parse(reader.result as string) as Partial<UserSettings>;\n          setSettings((prev) => ({ ...prev, ...imported }));\n          showToast(t('settings.importDone'), 'success');\n        } catch {\n          showToast(t('settings.importError'), 'error');\n        }\n      };\n      reader.readAsText(file);\n      e.target.value = '';\n    },\n    [showToast]\n  );\n\n  if (loading) {\n    return (\n      <div className=\"p-4 space-y-3\">\n        <CardSkeleton />\n        <CardSkeleton />\n      </div>\n    );\n  }\n\n  return (\n    <div className=\"px-3 py-4 sm:px-4 sm:max-w-2xl mx-auto\">\n      <div className=\"card\">\n        <h1 className=\"text-xl font-bold mb-2 text-[var(--text)]\">{t('settings.title')}</h1>\n        <p className=\"text-sm mb-0\" style={{ color: 'var(--text2)' }}>{t('settings.subtitle')}</p>\n      </div>\n\n      <NotificationPreview settings={settings} />\n\n      <AccordionSection title={t('settings.notifications')} icon=\"Bell\" defaultOpen badge={`${[settings.telegramNotifications, settings.emailNotifications, settings.pushoverNotifications].filter(Boolean).length}`}>\n        <div className=\"space-y-3\">\n          <label className=\"flex items-center justify-between min-h-[44px]\">\n            <span className=\"text-sm\">{t('settings.telegram')}</span>\n            <Toggle\n              checked={settings.telegramNotifications}\n              onChange={(v) => setSettings((prev) => ({ ...prev, telegramNotifications: v }))}\n              label={t('settings.telegram')}\n            />\n          </label>\n\n          <label className=\"flex items-center justify-between min-h-[44px]\">\n            <span className=\"text-sm\">{t('settings.email')}</span>\n            <Toggle\n              checked={settings.emailNotifications}\n              onChange={(v) => setSettings((prev) => ({ ...prev, emailNotifications: v }))}\n              label={t('settings.email')}\n            />\n          </label>\n\n          {settings.emailNotifications && (\n            <div>\n              <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"email-address\">\n                {t('settings.emailAddress')}\n              </label>\n              <input\n                id=\"email-address\"\n                type=\"email\"\n                value={settings.emailAddress}\n                onChange={(e) => setSettings((prev) => ({ ...prev, emailAddress: e.target.value }))}\n                className=\"input-field\"\n                placeholder=\"user@example.com\"\n              />\n            </div>\n          )}\n\n          <label className=\"flex items-center justify-between min-h-[44px]\">\n            <span className=\"text-sm\">{t('settings.dailySummary')}</span>\n            <Toggle\n              checked={settings.dailySummary}\n              onChange={(v) => setSettings((prev) => ({ ...prev, dailySummary: v }))}\n              label={t('settings.dailySummary')}\n            />\n          </label>\n\n          <label className=\"flex items-center justify-between min-h-[44px]\">\n            <span className=\"text-sm\">{t('settings.alertSound')}</span>\n            <Toggle\n              checked={settings.alertSound}\n              onChange={(v) => setSettings((prev) => ({ ...prev, alertSound: v }))}\n              label={t('settings.alertSound')}\n            />\n          </label>\n\n          <label className=\"flex items-center justify-between min-h-[44px]\">\n            <span className=\"text-sm\">{t('settings.spreadPush')}</span>\n            <Toggle\n              checked={settings.spreadNotifications}\n              onChange={(v) => setSettings((prev) => ({ ...prev, spreadNotifications: v }))}\n              label={t('settings.spreadPush')}\n            />\n          </label>\n\n          {settings.spreadNotifications && (\n            <div>\n              <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"spread-threshold\">\n                {t('settings.spreadThreshold')}\n              </label>\n              <input\n                id=\"spread-threshold\"\n                type=\"number\"\n                value={Number((settings.spreadMinThreshold * 100).toFixed(4))}\n                onChange={(e) => setSettings((prev) => ({ ...prev, spreadMinThreshold: (Number(e.target.value) || 0) / 100 }))}\n                step={0.01}\n                min={0}\n                className=\"input-field\"\n              />\n              <p className=\"text-xs mt-1\" style={{ color: 'var(--text3)' }}>{t('settings.spreadThresholdHint')}</p>\n            </div>\n          )}\n        </div>\n      </AccordionSection>\n\n      <AccordionSection title={t('settings.pushover')} icon=\"Smartphone\" defaultOpen={false}>\n        <p className=\"text-xs mb-3\" style={{ color: 'var(--text3)' }}>{t('settings.pushoverHint')}</p>\n        <div className=\"space-y-3\">\n          <label className=\"flex items-center justify-between min-h-[44px]\">\n            <span className=\"text-sm\">{t('settings.pushoverEnable')}</span>\n            <Toggle\n              checked={settings.pushoverNotifications}\n              onChange={(v) => setSettings((prev) => ({ ...prev, pushoverNotifications: v }))}\n              label={t('settings.pushoverEnable')}\n            />\n          </label>\n\n          {settings.pushoverNotifications && (\n            <>\n              <div>\n                <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"pushover-key\">\n                  {t('settings.pushoverKey')}\n                </label>\n                <input\n                  id=\"pushover-key\"\n                  type=\"text\"\n                  value={settings.pushoverKey}\n                  onChange={(e) => setSettings((prev) => ({ ...prev, pushoverKey: e.target.value }))}\n                  placeholder=\"uQiPBb1Rgc...\"\n                  className=\"input-field\"\n                />\n              </div>\n\n              <div>\n                <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"pushover-device\">\n                  {t('settings.pushoverDevice')}\n                </label>\n                <input\n                  id=\"pushover-device\"\n                  type=\"text\"\n                  value={settings.pushoverDevice}\n                  onChange={(e) => setSettings((prev) => ({ ...prev, pushoverDevice: e.target.value }))}\n                  placeholder={t('settings.pushoverDevicePlaceholder')}\n                  className=\"input-field\"\n                />\n              </div>\n            </>\n          )}\n        </div>\n      </AccordionSection>\n\n      <AccordionSection title={t('settings.defaultExchanges')} icon=\"Wallet\" defaultOpen={false}>\n        <ExchangeSelector\n          value={settings.defaultExchanges}\n          onChange={(next) => setSettings((prev) => ({ ...prev, defaultExchanges: next }))}\n          title={t('settings.defaultExchanges')}\n        />\n      </AccordionSection>\n\n      <AccordionSection title={t('settings.filters')} icon=\"Search\" defaultOpen={false}>\n        <div className=\"space-y-3\">\n          <div>\n            <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"min-volume\">\n              {t('settings.minVolume')}\n            </label>\n            <input\n              id=\"min-volume\"\n              type=\"number\"\n              value={settings.minVolumeFilter}\n              onChange={(e) => setSettings((prev) => ({ ...prev, minVolumeFilter: Number(e.target.value) || 0 }))}\n              min={0}\n              className=\"input-field\"\n            />\n          </div>\n\n          <div>\n            <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"min-rate\">\n              {t('settings.minRate')}\n            </label>\n            <input\n              id=\"min-rate\"\n              type=\"number\"\n              value={settings.minRateFilter}\n              onChange={(e) => setSettings((prev) => ({ ...prev, minRateFilter: Number(e.target.value) || 0 }))}\n              step={0.001}\n              min={0}\n              className=\"input-field\"\n            />\n          </div>\n        </div>\n      </AccordionSection>\n\n      <AccordionSection title={t('settings.language')} icon=\"Globe\" defaultOpen={false}>\n        <LanguageSwitcher\n          onChange={(l) => setSettings((prev) => ({ ...prev, language: l }))}\n        />\n      </AccordionSection>\n\n      <AccordionSection title={t('settings.appearance')} icon=\"Palette\" defaultOpen={false}>\n        <div className=\"space-y-3\">\n          <div>\n            <label className=\"block text-sm font-medium mb-1\" style={{ color: 'var(--text2)' }} htmlFor=\"settings-timezone\">{t('settings.timezone')}</label>\n            <select\n              id=\"settings-timezone\"\n              value={settings.timezone}\n              onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}\n              className=\"input-field\"\n            >\n              <option value=\"Europe/Moscow\">{t('settings.tzMsk')}</option>\n              <option value=\"Europe/Kaliningrad\">{t('settings.tzKaliningrad')}</option>\n              <option value=\"Europe/Samara\">{t('settings.tzSamara')}</option>\n              <option value=\"Asia/Yekaterinburg\">{t('settings.tzYekaterinburg')}</option>\n              <option value=\"Asia/Omsk\">{t('settings.tzOmsk')}</option>\n              <option value=\"Asia/Krasnoyarsk\">{t('settings.tzKrasnoyarsk')}</option>\n              <option value=\"Asia/Irkutsk\">{t('settings.tzIrkutsk')}</option>\n              <option value=\"Asia/Vladivostok\">{t('settings.tzVladivostok')}</option>\n              <option value=\"Asia/Kamchatka\">{t('settings.tzKamchatka')}</option>\n              <option value=\"UTC\">{t('settings.tzUtc')}</option>\n              <option value=\"Europe/London\">{t('settings.tzLondon')}</option>\n              <option value=\"America/New_York\">\n                {t('settings.tzNy')}\n              </option>\n              <option value=\"Asia/Tokyo\">{t('settings.tzTokyo')}</option>\n              <option value=\"Asia/Singapore\">{t('settings.tzSingapore')}</option>\n              <option value=\"Asia/Dubai\">{t('settings.tzDubai')}</option>\n            </select>\n          </div>\n        </div>\n      </AccordionSection>\n\n      <div className=\"flex items-center justify-between gap-3 pt-4 border-t\" style={{ borderColor: 'var(--border)' }}>\n        <button\n          type=\"button\"\n          onClick={handleReset}\n          className=\"btn btn-secondary min-h-[44px]\"\n        >\n          {t('settings.reset')}\n        </button>\n        <div className=\"flex items-center gap-2\">\n          <button\n            type=\"button\"\n            onClick={handleExport}\n            className=\"btn btn-secondary min-h-[44px]\"\n          >\n            {t('settings.export')}\n          </button>\n          <button\n            type=\"button\"\n            onClick={handleImport}\n            className=\"btn btn-secondary min-h-[44px]\"\n          >\n            {t('settings.import')}\n          </button>\n          <input\n            ref={fileInputRef}\n            type=\"file\"\n            accept=\".json\"\n            onChange={handleFileChange}\n            className=\"hidden\"\n          />\n          <button\n            type=\"button\"\n            onClick={handleSave}\n            disabled={saving}\n            className=\"btn btn-primary min-h-[44px]\"\n          >\n            {saving ? t('settings.saving') : t('settings.save')}\n          </button>\n        </div>\n      </div>\n    </div>\n  );\n}\n
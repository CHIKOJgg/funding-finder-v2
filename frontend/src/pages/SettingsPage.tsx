import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';

interface UserSettings {
  telegramNotifications: boolean;
  emailNotifications: boolean;
  emailAddress: string;
  dailySummary: boolean;
  alertSound: boolean;
  defaultExchanges: string[];
  theme: 'auto' | 'light' | 'dark';
  language: string;
  timezone: string;
  minVolumeFilter: number;
  minRateFilter: number;
}

const EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];
const DEFAULT_SETTINGS: UserSettings = {
  telegramNotifications: true,
  emailNotifications: false,
  emailAddress: '',
  dailySummary: true,
  alertSound: true,
  defaultExchanges: ['gate', 'binance', 'bybit', 'mexc', 'okx'],
  theme: 'auto',
  language: 'ru',
  timezone: 'Europe/Moscow',
  minVolumeFilter: 1000,
  minRateFilter: 0,
};

export function SettingsPage() {
  const { showToast } = useToast();
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
      showToast('Не удалось загрузить настройки', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res: any = await apiClient.updateSettings(settings);
      if (res.ok) {
        showToast('Настройки сохранены', 'success');
      } else {
        showToast('Ошибка сохранения', 'error');
      }
    } catch {
      showToast('Ошибка сети', 'error');
    } finally {
      setSaving(false);
    }
  }, [settings, showToast]);

  const handleReset = useCallback(async () => {
    try {
      const res: any = await apiClient.resetSettings();
      if (res.ok) {
        setSettings(DEFAULT_SETTINGS);
        showToast('Настройки сброшены', 'success');
      }
    } catch {
      showToast('Ошибка сброса', 'error');
    }
  }, [showToast]);

  const toggleExchange = (exchange: string) => {
    setSettings((prev) => ({
      ...prev,
      defaultExchanges: prev.defaultExchanges.includes(exchange)
        ? prev.defaultExchanges.filter((e) => e !== exchange)
        : [...prev.defaultExchanges, exchange],
    }));
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="card text-center py-8 text-gray-500" role="status">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-2">Настройки</h1>
        <p className="text-sm text-gray-600 mb-4">Управляйте уведомлениями и предпочтениями</p>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Уведомления</h2>

        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm">Telegram уведомления</span>
            <input
              type="checkbox"
              checked={settings.telegramNotifications}
              onChange={(e) => setSettings((prev) => ({ ...prev, telegramNotifications: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-sm">Email уведомления</span>
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
                Email адрес
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
            <span className="text-sm">Ежедневная сводка</span>
            <input
              type="checkbox"
              checked={settings.dailySummary}
              onChange={(e) => setSettings((prev) => ({ ...prev, dailySummary: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-sm">Звук оповещений</span>
            <input
              type="checkbox"
              checked={settings.alertSound}
              onChange={(e) => setSettings((prev) => ({ ...prev, alertSound: e.target.checked }))}
              className="w-5 h-5"
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Биржи по умолчанию</h2>
        <div className="flex flex-wrap gap-2">
          {EXCHANGES.map((exchange) => (
            <button
              key={exchange}
              onClick={() => toggleExchange(exchange)}
              className={`exchange-btn ${settings.defaultExchanges.includes(exchange) ? 'active' : ''}`}
            >
              {exchange.charAt(0).toUpperCase() + exchange.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Фильтры</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="min-volume">
              Мин. объём 24ч (USDT)
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
              Мин. ставка финансирования (%)
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
        <h2 className="text-lg font-semibold mb-3">Внешний вид</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Тема</label>
            <select
              value={settings.theme}
              onChange={(e) => setSettings((prev) => ({ ...prev, theme: e.target.value as 'auto' | 'light' | 'dark' }))}
              className="input-field"
            >
              <option value="auto">Авто</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Часовой пояс</label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
              className="input-field"
            >
              <option value="Europe/Moscow">Москва (MSK)</option>
              <option value="Europe/Kaliningrad">Калининград (UTC+2)</option>
              <option value="Europe/Samara">Самара (UTC+4)</option>
              <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option>
              <option value="Asia/Omsk">Омск (UTC+6)</option>
              <option value="Asia/Krasnoyarsk">Красноярск (UTC+7)</option>
              <option value="Asia/Irkutsk">Иркутск (UTC+8)</option>
              <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
              <option value="Asia/Kamchatka">Камчатка (UTC+12)</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">Лондон (UTC+1)</option>
              <option value="America/New_York">Нью-Йорк (UTC-5)</option>
              <option value="America/Chicago">Чикаго (UTC-6)</option>
              <option value="America/Los_Angeles">Лос-Анджелес (UTC-8)</option>
              <option value="Asia/Shanghai">Шанхай (UTC+8)</option>
              <option value="Asia/Tokyo">Токио (UTC+9)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary flex-1">
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
        <button onClick={handleReset} className="btn btn-secondary flex-1">
          Сбросить
        </button>
      </div>
    </div>
  );
}


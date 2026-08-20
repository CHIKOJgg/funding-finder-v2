import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconChevronLeft, IconChevronRight } from '../components/icons';
import { apiClient } from '../api/client';
import { useT } from '../i18n';

interface User {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  role: string;
  subscription: string;
  balance: number;
  trialScans: number;
  lastActive: string;
  createdAt: string;
  _count: {
    orders: number;
    generalAlerts: number;
    arbitrageAlerts: number;
    referrals: number;
  };
}

interface Stats {
  users: {
    total: number;
    today: number;
    activeWeek: number;
    activeMonth: number;
    bySubscription: Record<string, number>;
  };
  orders: {
    total: number;
    today: number;
    revenue: number;
    revenueToday: number;
  };
  system: {
    uptime: number;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    websocket: { connected: number };
    jobs: any;
    cacheSize: number;
  };
  alerts: { total: number };
  scans: { totalRecords: number };
}

interface Metrics {
  acquisition: { newUsersToday: number; newUsers7d: number; newUsers30d: number };
  funnel: {
    paidBase: number;
    trialActivated: number;
    paidOrders: number;
    payingUsers: number;
    trialToPaidPct: number;
    arppu: number;
    totalRevenue: number;
  };
  retention: { d7Pct: number; d30Pct: number };
  referrals: { referredUsers: number; referredPaid: number; conversionPct: number };
  acquisitionBySource: Record<string, number>;
}

interface Funnel {
  windowDays: number;
  funnel: Array<{ stage: string; value: number; conversionFromPrevPct: number }>;
  sourceBreakdown: Record<string, number>;
  variantComparison: Array<{
    variant: string;
    landingView: number;
    appOpen: number;
    trialStart: number;
    landingToAppPct: number;
    appToTrialPct: number;
  }>;
  totalLandingViews: number;
}

interface ActionStat {
  action: string;
  label: string;
  count: number;
}

interface ActionsData {
  totalEvents: number;
  topActions: ActionStat[];
  categoryBreakdown: Record<string, number>;
  platformBreakdown: Record<string, number>;
  windowDays: number;
}

interface ErrorStat {
  message: string;
  count: number;
  lastSeen: string;
  platform: string;
}

interface ErrorsData {
  totalErrors: number;
  topErrors: ErrorStat[];
  recentErrors: any[];
  windowDays: number;
}

interface LiveEvent {
  id: string;
  userId: string | null;
  sessionId: string | null;
  category: string;
  action: string;
  label: string | null;
  value: number | null;
  meta: string | null;
  platform: string | null;
  createdAt: string;
}

type StatTone = 'cobalt' | 'green' | 'amber' | 'red' | 'neutral';

const STAT_TONES: Record<StatTone, { bg: string; fg: string; label: string }> = {
  cobalt: { bg: 'var(--cobalt-soft)', fg: 'var(--cobalt-text)', label: 'var(--text2)' },
  green: { bg: 'var(--green-soft)', fg: 'var(--green)', label: 'var(--text2)' },
  amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)', label: 'var(--text2)' },
  red: { bg: 'var(--red-soft)', fg: 'var(--red)', label: 'var(--text2)' },
  neutral: { bg: 'var(--surface-2)', fg: 'var(--text)', label: 'var(--text3)' },
};

function StatCard({ value, label, tone = 'neutral', size = 'lg' }: { value: ReactNode; label: string; tone?: StatTone; size?: 'lg' | 'md' }) {
  const c = STAT_TONES[tone];
  return (
    <div className="p-3 rounded-lg" style={{ background: c.bg }}>
      <div className={`font-bold font-mono ${size === 'lg' ? 'text-2xl' : ''}`} style={{ color: c.fg }}>{value}</div>
      <div className="text-sm" style={{ color: c.label }}>{label}</div>
    </div>
  );
}

export function AdminPage() {
  const { user } = useApp();
  const { showToast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<'users' | 'stats' | 'metrics' | 'funnel' | 'withdrawals' | 'actions' | 'errors' | 'feed'>('stats');
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [actionsData, setActionsData] = useState<ActionsData | null>(null);
  const [errorsData, setErrorsData] = useState<ErrorsData | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveAutoRefresh, setLiveAutoRefresh] = useState(true);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [withdrawalFilter, setWithdrawalFilter] = useState<'pending' | 'completed' | 'rejected' | 'all'>('pending');
  const [completeModal, setCompleteModal] = useState<any | null>(null);
  const [txHash, setTxHash] = useState('');
  const [rejectConfirm, setRejectConfirm] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editUser, setEditUser] = useState<{ id: string; field: 'subscription' | 'balance'; value: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/stats');
      if (res.ok) setStats(res.stats);
      else setDenied(true);
    } catch {
      setDenied(true);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/metrics');
      if (res.ok) setMetrics(res.metrics);
    } catch { /* ignore */ }
  }, []);

  const fetchFunnel = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/funnel');
      if (res.ok) setFunnel(res);
    } catch { /* ignore */ }
  }, []);

  const fetchActionsStats = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/actions-stats');
      if (res.ok) setActionsData(res);
    } catch { /* ignore */ }
  }, []);

  const fetchErrorStats = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/error-stats');
      if (res.ok) setErrorsData(res);
    } catch { /* ignore */ }
  }, []);

  const fetchLiveFeed = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/live-feed?limit=50');
      if (res.ok) setLiveEvents(res.events || []);
    } catch { /* ignore */ }
  }, []);

  const fetchUsers = useCallback(async (p: number, q: string) => {
    try {
      const res: any = await apiClient.get(`/admin/users?page=${p}&limit=20${q ? `&search=${encodeURIComponent(q)}` : ''}`);
      if (res.ok) {
        setUsers(res.users);
        setTotalPages(res.pagination.totalPages);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchWithdrawals = useCallback(async (status: string) => {
    try {
      const res: any = await apiClient.getAdminWithdrawals(status, 100);
      if (res.ok) {
        setWithdrawals(res.withdrawals || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStats(), fetchUsers(page, search)]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'users') fetchUsers(page, search);
    if (tab === 'stats') fetchStats();
    if (tab === 'metrics') fetchMetrics();
    if (tab === 'funnel') fetchFunnel();
    if (tab === 'actions') fetchActionsStats();
    if (tab === 'errors') fetchErrorStats();
    if (tab === 'feed') fetchLiveFeed();
    if (tab === 'withdrawals') fetchWithdrawals(withdrawalFilter);
  }, [tab, page, search, withdrawalFilter, fetchUsers, fetchStats, fetchMetrics, fetchFunnel, fetchActionsStats, fetchErrorStats, fetchLiveFeed, fetchWithdrawals]);

  // Live feed auto-refresh interval
  useEffect(() => {
    if (tab !== 'feed' || !liveAutoRefresh) return;
    const interval = setInterval(fetchLiveFeed, 4000);
    return () => clearInterval(interval);
  }, [tab, liveAutoRefresh, fetchLiveFeed]);

  const handleUpdateSubscription = useCallback(async (userId: string, subscription: string) => {
    try {
      const res: any = await apiClient.patch(`/admin/users/${userId}/subscription`, { subscription });
      if (res.ok) {
        showToast(t('admin.subscriptionUpdated'), 'success');
        fetchUsers(page, search);
      }
    } catch {
      showToast(t('admin.subscriptionUpdateError'), 'error');
    }
    setEditUser(null);
  }, [page, search, fetchUsers, showToast]);

  const handleUpdateBalance = useCallback(async (userId: string, balance: string) => {
    const num = parseFloat(balance);
    if (isNaN(num) || num < 0) {
      showToast(t('admin.invalidBalance'), 'error');
      return;
    }
    try {
      const res: any = await apiClient.patch(`/admin/users/${userId}/balance`, { balance: num });
      if (res.ok) {
        showToast(t('admin.balanceUpdated'), 'success');
        fetchUsers(page, search);
      }
    } catch {
      showToast(t('admin.balanceUpdateError'), 'error');
    }
    setEditUser(null);
  }, [page, search, fetchUsers, showToast]);

  const handleDeleteUser = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      const res: any = await apiClient.delete(`/admin/users/${deleteConfirm}`);
      if (res.ok) {
        showToast(t('admin.userDeleted'), 'success');
        fetchUsers(page, search);
      }
    } catch {
      showToast(t('admin.userDeleteError'), 'error');
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, page, search, fetchUsers, showToast]);

  const handleCompleteWithdrawal = useCallback(async (id: string, transactionId?: string) => {
    try {
      const res: any = await apiClient.completeAdminWithdrawal(id, transactionId);
      if (res.ok) {
        showToast('Вывод успешно подтверждён!', 'success');
        fetchWithdrawals(withdrawalFilter);
      } else {
        showToast(res.error || 'Ошибка подтверждения вывода', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Ошибка сети', 'error');
    }
    setCompleteModal(null);
    setTxHash('');
  }, [withdrawalFilter, fetchWithdrawals, showToast]);

  const handleRejectWithdrawal = useCallback(async () => {
    if (!rejectConfirm) return;
    try {
      const res: any = await apiClient.rejectAdminWithdrawal(rejectConfirm.id);
      if (res.ok) {
        showToast(`Вывод отклонён, ${rejectConfirm.amount} USDT возвращены пользователю`, 'success');
        fetchWithdrawals(withdrawalFilter);
      } else {
        showToast(res.error || 'Ошибка отклонения вывода', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Ошибка сети', 'error');
    }
    setRejectConfirm(null);
  }, [rejectConfirm, withdrawalFilter, fetchWithdrawals, showToast]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return t('admin.uptimeFormat', { d, h, m });
  };

  if (!user) {
    return <div className="p-4 text-center text-[var(--text3)]">{t('admin.loginRequired')}</div>;
  }

  if (denied) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <div className="card p-6 text-center">
          <h1 className="text-xl font-bold mb-2 text-[var(--text)]">Admin Panel</h1>
          <p className="text-sm text-[var(--red)]">{t('admin.accessDenied') || 'Access denied — this panel is for administrators only.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h1 className="text-xl font-bold text-[var(--text)]">Панель управления и Аналитика</h1>
            <p className="text-xs text-[var(--text2)]">{t('admin.subtitle')}</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--green-soft)] text-[var(--green)] font-semibold font-mono">
            ● Live System
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-5 border-b border-[var(--border)] pb-3">
          {[
            { id: 'stats', label: t('admin.stats'), icon: '📊' },
            { id: 'funnel', label: 'Воронка продаж', icon: '📉' },
            { id: 'actions', label: 'Клики и Кнопки', icon: '🖱️' },
            { id: 'errors', label: 'Ошибки', icon: '🚨' },
            { id: 'feed', label: 'Живая лента', icon: '⚡' },
            { id: 'users', label: t('admin.users'), icon: '👥' },
            { id: 'withdrawals', label: 'Выводы', icon: '💳' },
            { id: 'metrics', label: 'Метрики LTV', icon: '📈' },
          ].map((tItem) => (
            <button
              key={tItem.id}
              onClick={() => setTab(tItem.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                tab === tItem.id
                  ? 'bg-[var(--cobalt)] text-[var(--on-brand)] shadow-sm'
                  : 'bg-[var(--surface-2)] text-[var(--text2)] hover:text-[var(--text)]'
              }`}
            >
              <span>{tItem.icon}</span>
              <span>{tItem.label}</span>
            </button>
          ))}
        </div>

        {tab === 'stats' && stats && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.usersSection')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard value={stats.users.total} label={t('admin.total')} tone="cobalt" />
                <StatCard value={stats.users.today} label={t('admin.today')} tone="green" />
                <StatCard value={stats.users.activeWeek} label={t('admin.active7')} tone="cobalt" />
                <StatCard value={stats.users.activeMonth} label={t('admin.active30')} tone="cobalt" />
              </div>
              <div className="mt-3 text-xs text-[var(--text2)]">
                {t('admin.bySubscription')} Free: <strong>{stats.users.bySubscription.free || 0}</strong> · Pro: <strong>{stats.users.bySubscription.pro || 0}</strong> · Pro+: <strong>{stats.users.bySubscription.proplus || 0}</strong>
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.finance')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard value={`${stats.orders.revenue} USDT`} label={t('admin.totalRevenue')} tone="green" />
                <StatCard value={`${stats.orders.revenueToday} USDT`} label={t('admin.revenueToday')} tone="green" />
                <StatCard value={stats.orders.total} label={t('admin.totalOrders')} tone="neutral" />
                <StatCard value={stats.orders.today} label={t('admin.ordersToday')} tone="neutral" />
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.system')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard value={formatUptime(stats.system.uptime)} label={t('admin.uptime')} tone="neutral" size="md" />
                <StatCard value={`${stats.system.memory.heapUsed} / ${stats.system.memory.heapTotal} MB`} label="Heap Memory" tone="neutral" size="md" />
                <StatCard value={stats.alerts.total} label={t('admin.alerts')} tone="amber" size="md" />
                <StatCard value={stats.scans.totalRecords} label={t('admin.scanRecords')} tone="cobalt" size="md" />
              </div>
            </div>
          </div>
        )}

        {tab === 'funnel' && funnel && (
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-base font-semibold">Воронка конверсии (За 30 дней)</h2>
                <span className="text-xs text-[var(--text3)]">Всего переходов: <strong>{funnel.totalLandingViews}</strong></span>
              </div>
              <div className="space-y-3 mt-4">
                {funnel.funnel.map((f, i) => {
                  const maxVal = Math.max(...funnel.funnel.map((s) => s.value), 1);
                  const pctWidth = Math.max((f.value / maxVal) * 100, 3);
                  const labels: Record<string, string> = {
                    landing_view: '1. Посещение лендинга / Ссылка',
                    app_open: '2. Открытие Mini App / Web-приложения',
                    scan_run: '3. Сканирование ставок фандинга',
                    paywall_view: '4. Просмотр тарифов и пейволла',
                    trial_start: '5. Активация 3-дневного триала',
                    checkout_start: '6. Переход к оплате подписки',
                    paid: '7. Успешная оплата (Подписка активна)',
                  };

                  return (
                    <div key={f.stage} className="p-3 bg-[var(--surface-2)] rounded-xl">
                      <div className="flex justify-between text-xs font-semibold mb-1.5">
                        <span className="text-[var(--text)]">{labels[f.stage] || f.stage}</span>
                        <span className="text-[var(--brand)] font-mono">
                          {f.value} польз. {i > 0 && <span className="text-[var(--text3)] font-normal">({f.conversionFromPrevPct}% от пред.)</span>}
                        </span>
                      </div>
                      <div className="w-full bg-[var(--surface)] h-3 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all bg-gradient-to-r from-[var(--cobalt)] to-[var(--green)]"
                          style={{ width: `${pctWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {funnel.variantComparison && funnel.variantComparison.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">A/B Тестирование офферов</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {funnel.variantComparison.map((v) => (
                    <div key={v.variant} className="p-3 bg-[var(--surface-2)] rounded-lg text-xs space-y-1">
                      <div className="font-bold text-[var(--text)] text-sm">Вариант {v.variant}</div>
                      <div>Посещений: <strong>{v.landingView}</strong> → Открытий: <strong>{v.appOpen}</strong> ({v.landingToAppPct}%)</div>
                      <div>Триалов: <strong>{v.trialStart}</strong> ({v.appToTrialPct}%)</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'actions' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold">Аналитика кликов и действий пользователей</h2>
                <p className="text-xs text-[var(--text3)]">Какие кнопки нажимают чаще всего и какие остаются незамеченными</p>
              </div>
              <button onClick={fetchActionsStats} className="btn text-xs py-1 px-2.5 w-auto">
                Обновить
              </button>
            </div>

            {actionsData ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard value={actionsData.totalEvents} label="Всего кликов/событий" tone="cobalt" />
                  <StatCard value={actionsData.topActions.length} label="Уникальных действий" tone="neutral" />
                  <StatCard
                    value={`${actionsData.platformBreakdown.miniapp || 0} / ${actionsData.platformBreakdown.web || 0}`}
                    label="MiniApp / Web"
                    tone="green"
                    size="md"
                  />
                  <StatCard value={`${actionsData.windowDays} дней`} label="Окно выборки" tone="neutral" size="md" />
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">🔥 Топ-25 самых нажимаемых кнопок и элементов</h3>
                  <div className="space-y-2">
                    {actionsData.topActions.slice(0, 25).map((act, i) => {
                      const maxCount = actionsData.topActions[0]?.count || 1;
                      const widthPct = Math.max((act.count / maxCount) * 100, 4);

                      return (
                        <div key={i} className="p-2.5 bg-[var(--surface-2)] rounded-lg text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-[var(--text)] truncate max-w-[70%]">
                              <span className="text-[var(--text3)] mr-2 font-mono">#{i + 1}</span>
                              {act.label || act.action}
                            </span>
                            <span className="font-mono font-bold text-[var(--brand)]">{act.count} кликов</span>
                          </div>
                          <div className="w-full bg-[var(--surface)] h-2 rounded-full overflow-hidden">
                            <div className="h-full bg-[var(--cobalt)] rounded-full" style={{ width: `${widthPct}%` }} />
                          </div>
                          <div className="text-[10px] text-[var(--text3)] mt-1 font-mono">Действие: {act.action}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Категории взаимодействия</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(actionsData.categoryBreakdown).map(([cat, count]) => (
                      <div key={cat} className="p-2.5 bg-[var(--surface-2)] rounded-lg text-xs">
                        <div className="text-[var(--text3)] uppercase font-semibold">{cat}</div>
                        <div className="text-base font-bold text-[var(--text)] font-mono">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
            )}
          </div>
        )}

        {tab === 'errors' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold">Телеметрия сбоев и ошибок клиентов</h2>
                <p className="text-xs text-[var(--text3)]">Ошибки JavaScript, сбои API и отклоненные запросы</p>
              </div>
              <button onClick={fetchErrorStats} className="btn text-xs py-1 px-2.5 w-auto">
                Обновить
              </button>
            </div>

            {errorsData ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard value={errorsData.totalErrors} label="Всего ошибок (7 дней)" tone={errorsData.totalErrors > 0 ? 'red' : 'green'} />
                  <StatCard value={errorsData.topErrors.length} label="Уникальных типов сбоев" tone="neutral" />
                  <StatCard value={`${errorsData.windowDays} дней`} label="Период мониторинга" tone="neutral" size="md" />
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">🚨 Часто возникающие ошибки</h3>
                  {errorsData.topErrors.length === 0 ? (
                    <div className="p-6 bg-[var(--green-soft)] rounded-xl text-center text-xs text-[var(--green)] font-semibold">
                      🎉 Ошибок на клиентах за последние 7 дней не зафиксировано!
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {errorsData.topErrors.map((err, i) => (
                        <div key={i} className="p-3 bg-[var(--surface-2)] border border-[var(--red-soft)] rounded-xl text-xs">
                          <div className="flex justify-between items-start gap-2">
                            <div className="font-semibold text-[var(--red)] break-all">{err.message}</div>
                            <span className="px-2 py-0.5 rounded bg-[var(--red-soft)] text-[var(--red)] font-mono font-bold whitespace-nowrap">
                              {err.count} раз
                            </span>
                          </div>
                          <div className="flex gap-3 text-[11px] text-[var(--text3)] mt-2">
                            <span>Платформа: <strong>{err.platform}</strong></span>
                            <span>Последний раз: {new Date(err.lastSeen).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
            )}
          </div>
        )}

        {tab === 'feed' && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="text-base font-semibold">Живая лента действий пользователей</h2>
                <p className="text-xs text-[var(--text3)]">Поток событий клиентов в реальном времени</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLiveAutoRefresh(!liveAutoRefresh)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
                    liveAutoRefresh ? 'bg-[var(--green-soft)] text-[var(--green)]' : 'bg-[var(--surface-2)] text-[var(--text3)]'
                  }`}
                >
                  {liveAutoRefresh ? '● Автообновление (4с)' : '⏸ Пауза'}
                </button>
                <button onClick={fetchLiveFeed} className="btn text-xs py-1 px-2.5 w-auto">
                  Обновить
                </button>
              </div>
            </div>

            {liveEvents.length === 0 ? (
              <div className="text-center py-8 text-[var(--text3)]">Событий пока нет</div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {liveEvents.map((ev) => (
                  <div key={ev.id} className="p-2.5 bg-[var(--surface-2)] rounded-lg text-xs flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold uppercase ${
                          ev.category === 'conversion' ? 'bg-[var(--green-soft)] text-[var(--green)]' :
                          ev.category === 'error' ? 'bg-[var(--red-soft)] text-[var(--red)]' :
                          'bg-[var(--cobalt-soft)] text-[var(--cobalt-text)]'
                        }`}>
                          {ev.category}
                        </span>
                        <span className="font-semibold text-[var(--text)] truncate">{ev.action}</span>
                        {ev.label && <span className="text-[var(--text2)] truncate">«{ev.label}»</span>}
                      </div>
                      <div className="text-[10px] text-[var(--text3)] mt-0.5">
                        Пользователь: <span className="font-mono">{ev.userId || ev.sessionId || 'anon'}</span> · Платформа: {ev.platform || 'web'}
                      </div>
                    </div>
                    <div className="text-[11px] text-[var(--text3)] font-mono flex-shrink-0">
                      {new Date(ev.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'users' && (
          <div>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder={t('admin.searchPlaceholder')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="input-field flex-1"
              />
            </div>

            {loading ? (
              <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
            ) : users.length === 0 ? (
              <div className="text-center py-8 text-[var(--text3)]">{t('admin.noUsers')}</div>
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.telegramId} className="p-3 border border-[var(--border)] rounded-lg text-sm">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {u.firstName || u.username || u.telegramId}
                          {u.role === 'admin' && <span className="ml-1 text-xs bg-[var(--red-soft)] text-[var(--red)] px-1.5 py-0.5 rounded">admin</span>}
                        </div>
                        <div className="text-xs text-[var(--text3)] truncate">
                          ID: {u.telegramId} · {u.username ? `@${u.username}` : ''}
                        </div>
                        <div className="text-xs text-[var(--text3)] mt-1">
                          {t('admin.created', { created: new Date(u.createdAt).toLocaleDateString(), active: new Date(u.lastActive).toLocaleDateString() })}
                        </div>
                        <div className="text-xs text-[var(--text3)]">
                          {t('admin.counts', { orders: u._count.orders, alerts: u._count.generalAlerts + u._count.arbitrageAlerts, referrals: u._count.referrals })}
                        </div>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <div className="font-semibold">{u.subscription}</div>
                        <div className="text-xs text-[var(--text3)]">{u.balance} USDT</div>
                      </div>
                    </div>
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => setEditUser({ id: u.telegramId, field: 'subscription', value: u.subscription })}
                        className="text-xs bg-[var(--cobalt-soft)] text-[var(--cobalt-text)] px-2 py-1 rounded active:opacity-80"
                      >
                        {t('admin.changeSubscription')}
                      </button>
                      <button
                        onClick={() => setEditUser({ id: u.telegramId, field: 'balance', value: String(u.balance) })}
                        className="text-xs bg-[var(--green-soft)] text-[var(--green)] px-2 py-1 rounded active:opacity-80"
                      >
                        {t('admin.changeBalance')}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(u.telegramId)}
                        className="text-xs bg-[var(--red-soft)] text-[var(--red)] px-2 py-1 rounded active:opacity-80 ml-auto"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn text-sm py-1 px-3 w-auto"
                >
                  <IconChevronLeft size={14} /> {t('admin.prev')}
                </button>
                <span className="py-1 text-sm text-[var(--text2)]">{t('admin.page', { page, total: totalPages })}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="btn text-sm py-1 px-3 w-auto"
                >
                  {t('admin.next')} <IconChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'withdrawals' && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-lg font-semibold">Управление выводами средств</h2>
              <div className="flex gap-1 bg-[var(--surface-2)] p-1 rounded-lg">
                {(['pending', 'completed', 'rejected', 'all'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setWithdrawalFilter(st)}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
                      withdrawalFilter === st
                        ? 'bg-[var(--cobalt)] text-[var(--on-brand)]'
                        : 'text-[var(--text2)] hover:text-[var(--text)]'
                    }`}
                  >
                    {st === 'pending' ? 'Ожидают' : st === 'completed' ? 'Выполнены' : st === 'rejected' ? 'Отклонены' : 'Все'}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
            ) : withdrawals.length === 0 ? (
              <div className="text-center py-8 text-[var(--text3)]">Заявок на вывод не найдено</div>
            ) : (
              <div className="space-y-3">
                {withdrawals.map((w) => {
                  const isPending = w.status === 'pending';
                  const isCompleted = w.status === 'completed';
                  const isRejected = w.status === 'rejected';
                  const statusColor = isCompleted ? 'var(--green)' : isRejected ? 'var(--red)' : 'var(--amber)';
                  const statusBg = isCompleted ? 'var(--green-soft)' : isRejected ? 'var(--red-soft)' : 'var(--amber-soft)';

                  return (
                    <div key={w.id} className="p-3.5 border border-[var(--border)] rounded-xl text-sm bg-[var(--surface)]">
                      <div className="flex flex-wrap justify-between items-start gap-2">
                        <div className="flex-1 min-w-[200px]">
                          <div className="font-semibold text-base">
                            {w.amount} {w.currency} <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--brand)] font-mono">{w.network}</span>
                          </div>
                          <div className="text-xs text-[var(--text2)] mt-1">
                            Пользователь: <span className="font-medium text-[var(--text)]">{w.user?.firstName || w.user?.username || w.userId}</span>
                            {w.user?.username && ` (@${w.user.username})`} · Баланс: {w.user?.balance ?? 0} USDT
                          </div>
                          <div className="text-xs text-[var(--text3)] font-mono mt-1 break-all bg-[var(--surface-2)] p-1.5 rounded">
                            Адрес: {w.address}
                          </div>
                          {w.transactionId && (
                            <div className="text-xs text-[var(--green)] font-mono mt-1 break-all">
                              TxID: {w.transactionId}
                            </div>
                          )}
                          <div className="text-[11px] text-[var(--text3)] mt-1">
                            Создано: {new Date(w.createdAt).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <span
                            className="text-xs px-2.5 py-1 rounded-full font-semibold"
                            style={{ color: statusColor, background: statusBg }}
                          >
                            {isPending ? 'Ожидает выплаты' : isCompleted ? 'Выплачено' : 'Отклонено'}
                          </span>

                          {isPending && (
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={() => {
                                  setCompleteModal({ id: w.id, amount: w.amount, user: w.user?.username || w.userId, address: w.address, network: w.network });
                                  setTxHash('');
                                }}
                                className="text-xs bg-[var(--green)] text-white px-3 py-1.5 rounded-lg font-semibold hover:opacity-90 active:opacity-80 transition-opacity"
                              >
                                Подтвердить
                              </button>
                              <button
                                onClick={() => setRejectConfirm({ id: w.id, amount: w.amount, user: w.user?.username || w.userId })}
                                className="text-xs bg-[var(--red-soft)] text-[var(--red)] px-2.5 py-1.5 rounded-lg font-semibold hover:opacity-90 active:opacity-80 transition-opacity"
                              >
                                Отклонить
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'metrics' && metrics && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.acquisition')}</h2>
              <div className="grid grid-cols-3 gap-3">
                <StatCard value={metrics.acquisition.newUsersToday} label={t('admin.newUsersToday')} tone="green" />
                <StatCard value={metrics.acquisition.newUsers7d} label={t('admin.newUsers7d')} tone="cobalt" />
                <StatCard value={metrics.acquisition.newUsers30d} label={t('admin.newUsers30d')} tone="cobalt" />
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.conversion')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard value={metrics.funnel.trialActivated} label={t('admin.trialActivated')} tone="amber" />
                <StatCard value={metrics.funnel.paidOrders} label={t('admin.paidOrders')} tone="green" />
                <StatCard value={`${metrics.funnel.trialToPaidPct}%`} label={t('admin.trialToPaid')} tone="green" />
                <StatCard value={`${metrics.funnel.arppu.toFixed(2)} USDT`} label={t('admin.arppu')} tone="cobalt" />
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.retention')}</h2>
              <div className="grid grid-cols-2 gap-3">
                <StatCard value={`${metrics.retention.d7Pct}%`} label={t('admin.d7Retention')} tone="cobalt" />
                <StatCard value={`${metrics.retention.d30Pct}%`} label={t('admin.d30Retention')} tone="cobalt" />
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold mb-3">{t('admin.referralProgram')}</h2>
              <div className="grid grid-cols-3 gap-3">
                <StatCard value={metrics.referrals.referredUsers} label={t('admin.referredUsers')} tone="cobalt" />
                <StatCard value={metrics.referrals.referredPaid} label={t('admin.referredPaid')} tone="green" />
                <StatCard value={`${metrics.referrals.conversionPct}%`} label={t('admin.referralConversion')} tone="green" />
              </div>
            </div>
          </div>
        )}

        {/* Complete Withdrawal Modal */}
        {completeModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--surface)] card rounded-xl max-w-md w-full p-5 shadow-2xl">
              <h2 className="text-lg font-bold mb-2 text-[var(--text)]">Подтверждение выплаты</h2>
              <p className="text-xs text-[var(--text2)] mb-4">
                Вы подтверждаете отправку <strong>{completeModal.amount} USDT</strong> пользователю {completeModal.user} в сети <strong>{completeModal.network}</strong>.
              </p>

              <div className="mb-4 bg-[var(--surface-2)] p-2.5 rounded-lg text-xs font-mono break-all text-[var(--text)]">
                {completeModal.address}
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-[var(--text2)] mb-1">
                  Хэш транзакции (TxID / Tx Hash) — необязательно:
                </label>
                <input
                  type="text"
                  placeholder="0x... или tx hash"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  className="input-field w-full font-mono text-xs"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={() => setCompleteModal(null)} className="btn btn-secondary flex-1 py-2 text-sm">
                  Отмена
                </button>
                <button
                  onClick={() => handleCompleteWithdrawal(completeModal.id, txHash)}
                  className="btn btn-primary flex-1 py-2 text-sm font-semibold"
                >
                  Подтвердить перевод
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reject Withdrawal Modal */}
        <ConfirmDialog
          open={rejectConfirm !== null}
          title="Отклонить вывод средств?"
          message={rejectConfirm ? `Вы уверены, что хотите отклонить заявку на ${rejectConfirm.amount} USDT? Сумма будет автоматически возвращена на баланс пользователя.` : ''}
          confirmText="Отклонить и вернуть"
          cancelText="Отмена"
          variant="danger"
          onConfirm={handleRejectWithdrawal}
          onCancel={() => setRejectConfirm(null)}
        />

        {editUser && (
          <div className="fixed inset-0 bg-[rgba(5,7,12,0.6)] flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-xl max-w-md w-full" style={{ color: 'var(--text)' }}>
              <div className="card">
                <h2 className="text-lg font-semibold mb-4">
                  {editUser.field === 'subscription' ? t('admin.changeSubscription') : t('admin.editBalanceTitle')}
                </h2>
                {editUser.field === 'subscription' ? (
                  <select
                    value={editUser.value}
                    onChange={(e) => setEditUser({ ...editUser, value: e.target.value })}
                    className="input-field mb-4"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="proplus">Pro+</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    value={editUser.value}
                    onChange={(e) => setEditUser({ ...editUser, value: e.target.value })}
                    min={0}
                    step={0.01}
                    className="input-field mb-4"
                  />
                )}
                <div className="flex gap-2">
                  <button onClick={() => setEditUser(null)} className="btn btn-secondary flex-1">{t('common.cancel')}</button>
                  <button
                    onClick={() =>
                      editUser.field === 'subscription'
                        ? handleUpdateSubscription(editUser.id, editUser.value)
                        : handleUpdateBalance(editUser.id, editUser.value)
                    }
                    className="btn btn-primary flex-1"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={deleteConfirm !== null}
          title={t('admin.deleteUserTitle')}
          message={t('admin.deleteUserMessage')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          variant="danger"
          onConfirm={handleDeleteUser}
          onCancel={() => setDeleteConfirm(null)}
        />
      </div>
    </div>
  );
}

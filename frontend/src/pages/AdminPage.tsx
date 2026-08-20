import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconChevronLeft, IconChevronRight, IconDownload, IconExternalLink, IconSearch } from '../components/icons';
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
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

interface SupportTicketItem {
  id: string;
  name: string | null;
  contact: string | null;
  userId: string | null;
  category: string;
  message: string;
  status: string;
  threadId: number | null;
  topicUrl: string | null;
  createdAt: string;
}

interface SupportStats {
  totalTickets: number;
  ticketsToday: number;
  ticketsWeek: number;
  categoryBreakdown: Record<string, number>;
  statusBreakdown: Record<string, number>;
  recentTickets: SupportTicketItem[];
  faqStats: { totalItems: number; totalHits: number };
}

interface MarketingCampaign {
  source: string;
  visitors: number;
  landingViews: number;
  appOpens: number;
  scans: number;
  paywallViews: number;
  trialStarts: number;
  paid: number;
  uniqueUsersCount: number;
  conversionRatePct: number;
  trialRatePct: number;
}

interface MarketingData {
  windowDays: number;
  totalCampaigns: number;
  campaigns: MarketingCampaign[];
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
    <div className="p-3 rounded-xl border border-[var(--border)]" style={{ background: c.bg }}>
      <div className={`font-bold font-mono ${size === 'lg' ? 'text-2xl' : 'text-lg'}`} style={{ color: c.fg }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: c.label }}>{label}</div>
    </div>
  );
}

function exportToCsv(filename: string, rows: Array<Record<string, any>>) {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          let val = row[h];
          if (val === null || val === undefined) return '""';
          if (typeof val === 'object') val = JSON.stringify(val);
          val = String(val).replace(/"/g, '""');
          return `"${val}"`;
        })
        .join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function AdminPage() {
  const { user } = useApp();
  const { showToast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<
    'stats' | 'marketing' | 'funnel' | 'actions' | 'support' | 'errors' | 'feed' | 'users' | 'withdrawals' | 'metrics'
  >('stats');

  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [actionsData, setActionsData] = useState<ActionsData | null>(null);
  const [errorsData, setErrorsData] = useState<ErrorsData | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveAutoRefresh, setLiveAutoRefresh] = useState(true);
  const [supportStats, setSupportStats] = useState<SupportStats | null>(null);
  const [marketingData, setMarketingData] = useState<MarketingData | null>(null);
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

  // Filters for actions & feed
  const [actionSearch, setActionSearch] = useState('');
  const [feedCategoryFilter, setFeedCategoryFilter] = useState('all');

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

  const fetchSupportStats = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/support-stats');
      if (res.ok) setSupportStats(res);
    } catch { /* ignore */ }
  }, []);

  const fetchMarketingData = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/marketing-campaigns');
      if (res.ok) setMarketingData(res);
    } catch { /* ignore */ }
  }, []);

  const fetchLiveFeed = useCallback(async () => {
    try {
      const catParam = feedCategoryFilter !== 'all' ? `&category=${feedCategoryFilter}` : '';
      const res: any = await apiClient.get(`/admin/live-feed?limit=100${catParam}`);
      if (res.ok) setLiveEvents(res.events || []);
    } catch { /* ignore */ }
  }, [feedCategoryFilter]);

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
    if (tab === 'marketing') fetchMarketingData();
    if (tab === 'support') fetchSupportStats();
    if (tab === 'metrics') fetchMetrics();
    if (tab === 'funnel') fetchFunnel();
    if (tab === 'actions') fetchActionsStats();
    if (tab === 'errors') fetchErrorStats();
    if (tab === 'feed') fetchLiveFeed();
    if (tab === 'withdrawals') fetchWithdrawals(withdrawalFilter);
  }, [
    tab,
    page,
    search,
    withdrawalFilter,
    feedCategoryFilter,
    fetchUsers,
    fetchStats,
    fetchMarketingData,
    fetchSupportStats,
    fetchMetrics,
    fetchFunnel,
    fetchActionsStats,
    fetchErrorStats,
    fetchLiveFeed,
    fetchWithdrawals,
  ]);

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
    <div className="p-4 max-w-6xl mx-auto">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h1 className="text-xl font-bold text-[var(--text)]">Панель управления и Маркетинг</h1>
            <p className="text-xs text-[var(--text2)]">Полный мониторинг пользователей, кликов, поддержки и конверсий</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--green-soft)] text-[var(--green)] font-semibold font-mono">
            ● Live System
          </span>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 mb-5 border-b border-[var(--border)] pb-3">
          {[
            { id: 'stats', label: t('admin.stats'), icon: '📊' },
            { id: 'marketing', label: 'Маркетинг & UTM', icon: '🎯' },
            { id: 'funnel', label: 'Воронка продаж', icon: '📉' },
            { id: 'actions', label: 'Клики и Кнопки', icon: '🖱️' },
            { id: 'support', label: 'Поддержка & FAQ', icon: '🎫' },
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

        {/* TAB 1: OVERVIEW STATS */}
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

        {/* TAB 2: MARKETING & UTM CAMPAIGNS */}
        {tab === 'marketing' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="text-base font-semibold">Анализ маркетинговых каналов & UTM-кампаний</h2>
                <p className="text-xs text-[var(--text3)]">Источники трафика, конверсия по каналам и платящие пользователи (за 30 дней)</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => marketingData?.campaigns && exportToCsv('funding_finder_marketing.csv', marketingData.campaigns)}
                  className="btn btn-secondary text-xs py-1 px-3 w-auto flex items-center gap-1.5"
                >
                  <IconDownload size={14} /> Экспорт в CSV
                </button>
                <button onClick={fetchMarketingData} className="btn text-xs py-1 px-3 w-auto">
                  Обновить
                </button>
              </div>
            </div>

            {marketingData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard value={marketingData.totalCampaigns} label="Всего каналов / меток" tone="cobalt" />
                  <StatCard
                    value={marketingData.campaigns.reduce((acc, c) => acc + c.visitors, 0)}
                    label="Всего посетителей"
                    tone="neutral"
                  />
                  <StatCard
                    value={marketingData.campaigns.reduce((acc, c) => acc + c.paid, 0)}
                    label="Всего оплат из каналов"
                    tone="green"
                  />
                  <StatCard
                    value={`${(
                      (marketingData.campaigns.reduce((acc, c) => acc + c.paid, 0) /
                        Math.max(marketingData.campaigns.reduce((acc, c) => acc + c.visitors, 0), 1)) *
                      100
                    ).toFixed(2)}%`}
                    label="Средняя конверсия в оплату"
                    tone="green"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[var(--surface-2)] text-[var(--text2)] uppercase">
                      <tr>
                        <th className="p-2.5 rounded-l-lg">Источник / Кампания</th>
                        <th className="p-2.5 text-right">Посетители</th>
                        <th className="p-2.5 text-right">Сканы</th>
                        <th className="p-2.5 text-right">Пейволл</th>
                        <th className="p-2.5 text-right">Триал</th>
                        <th className="p-2.5 text-right font-bold text-[var(--green)]">Оплаты</th>
                        <th className="p-2.5 text-right rounded-r-lg">Конверсия %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {marketingData.campaigns.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-muted">Кампаний пока не зафиксировано</td>
                        </tr>
                      ) : (
                        marketingData.campaigns.map((c, i) => (
                          <tr key={i} className="hover:bg-[var(--surface-2)] transition-colors">
                            <td className="p-2.5 font-semibold text-[var(--text)] flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--cobalt)]" />
                              {c.source}
                            </td>
                            <td className="p-2.5 text-right font-mono">{c.visitors}</td>
                            <td className="p-2.5 text-right font-mono text-[var(--text2)]">{c.scans}</td>
                            <td className="p-2.5 text-right font-mono text-[var(--text2)]">{c.paywallViews}</td>
                            <td className="p-2.5 text-right font-mono text-[var(--amber)] font-bold">{c.trialStarts}</td>
                            <td className="p-2.5 text-right font-mono text-[var(--green)] font-bold">{c.paid}</td>
                            <td className="p-2.5 text-right font-mono font-bold">
                              <span className={`px-2 py-0.5 rounded ${c.conversionRatePct > 0 ? 'bg-[var(--green-soft)] text-[var(--green)]' : 'bg-[var(--surface-2)] text-muted'}`}>
                                {c.conversionRatePct}%
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
            )}
          </div>
        )}

        {/* TAB 3: FUNNEL */}
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
                    checkout_start: '6. Переход к оплате',
                    paid: '7. Успешная оплата подписки 🎉',
                  };

                  return (
                    <div key={f.stage} className="p-3 bg-[var(--surface-2)] rounded-xl text-xs">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="font-semibold text-[var(--text)]">{labels[f.stage] || f.stage}</span>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="font-bold text-sm text-[var(--text)]">{f.value}</span>
                          {i > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--brand)] font-semibold">
                              {f.conversionFromPrevPct}% от пред.
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-[var(--surface)] h-2.5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--cobalt)] rounded-full transition-all duration-500"
                          style={{ width: `${pctWidth}%`, background: i === funnel.funnel.length - 1 ? 'var(--green)' : 'var(--cobalt)' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">Сравнение заголовков A/B тестирования</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {funnel.variantComparison.map((v) => (
                  <div key={v.variant} className="p-4 bg-[var(--surface-2)] rounded-xl text-xs space-y-2 border border-[var(--border)]">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-[var(--brand)]">Вариант «{v.variant}»</span>
                      <span className="text-muted font-mono">{v.landingView} показов</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <div className="p-2 bg-[var(--surface)] rounded-lg">
                        <div className="text-muted">Конверсия в App</div>
                        <div className="font-bold text-base font-mono text-[var(--text)]">{v.landingToAppPct}%</div>
                      </div>
                      <div className="p-2 bg-[var(--surface)] rounded-lg">
                        <div className="text-muted">Конверсия в Триал</div>
                        <div className="font-bold text-base font-mono text-[var(--green)]">{v.appToTrialPct}%</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: BUTTON CLICKS & ACTIONS */}
        {tab === 'actions' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="text-base font-semibold">Телеметрия нажатий кнопок & действий</h2>
                <p className="text-xs text-[var(--text3)]">Полный лог взаимодействия пользователей с интерфейсом</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => actionsData?.topActions && exportToCsv('funding_finder_button_clicks.csv', actionsData.topActions)}
                  className="btn btn-secondary text-xs py-1 px-3 w-auto flex items-center gap-1.5"
                >
                  <IconDownload size={14} /> Экспорт в CSV
                </button>
                <button onClick={fetchActionsStats} className="btn text-xs py-1 px-3 w-auto">
                  Обновить
                </button>
              </div>
            </div>

            {actionsData ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard value={actionsData.totalEvents} label="Всего кликов/событий" tone="cobalt" />
                  <StatCard value={actionsData.topActions.length} label="Уникальных кнопок" tone="neutral" />
                  <StatCard
                    value={`${actionsData.platformBreakdown.miniapp || 0} / ${actionsData.platformBreakdown.web || 0}`}
                    label="MiniApp / Web"
                    tone="green"
                    size="md"
                  />
                  <StatCard value={`${actionsData.windowDays} дней`} label="Окно выборки" tone="neutral" size="md" />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-semibold">🔥 Рейтинг нажимаемых кнопок и элементов</h3>
                    <div className="relative w-48">
                      <input
                        type="text"
                        placeholder="Поиск по кнопкам..."
                        value={actionSearch}
                        onChange={(e) => setActionSearch(e.target.value)}
                        className="input-field text-xs py-1 pl-7 w-full"
                      />
                      <IconSearch size={12} className="absolute left-2.5 top-2 text-muted" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {actionsData.topActions
                      .filter((act) => !actionSearch || act.label.toLowerCase().includes(actionSearch.toLowerCase()) || act.action.toLowerCase().includes(actionSearch.toLowerCase()))
                      .map((act, i) => {
                        const maxCount = actionsData.topActions[0]?.count || 1;
                        const widthPct = Math.max((act.count / maxCount) * 100, 4);

                        return (
                          <div key={i} className="p-2.5 bg-[var(--surface-2)] rounded-xl text-xs">
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
                            <div className="text-[10px] text-[var(--text3)] mt-1 font-mono">Событие: {act.action}</div>
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

        {/* TAB 5: SUPPORT & FAQ */}
        {tab === 'support' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="text-base font-semibold">Служба поддержки & База знаний FAQ</h2>
                <p className="text-xs text-[var(--text3)]">Все обращения пользователей, категории вопросов и статус топиков в Telegram</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => supportStats?.recentTickets && exportToCsv('funding_finder_support_tickets.csv', supportStats.recentTickets)}
                  className="btn btn-secondary text-xs py-1 px-3 w-auto flex items-center gap-1.5"
                >
                  <IconDownload size={14} /> Экспорт в CSV
                </button>
                <button onClick={fetchSupportStats} className="btn text-xs py-1 px-3 w-auto">
                  Обновить
                </button>
              </div>
            </div>

            {supportStats ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard value={supportStats.totalTickets} label="Всего обращений" tone="cobalt" />
                  <StatCard value={supportStats.ticketsToday} label="Обращений сегодня" tone="green" />
                  <StatCard value={supportStats.ticketsWeek} label="За последние 7 дней" tone="cobalt" />
                  <StatCard value={supportStats.faqStats.totalHits} label="Просмотров FAQ" tone="amber" />
                </div>

                {/* Categories breakdown */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Распределение вопросов по темам</h3>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {Object.entries(supportStats.categoryBreakdown).map(([cat, count]) => (
                      <div key={cat} className="p-2.5 bg-[var(--surface-2)] rounded-xl text-xs">
                        <div className="text-muted uppercase text-[10px] font-bold">{cat}</div>
                        <div className="text-base font-bold text-[var(--text)] font-mono mt-0.5">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Tickets Table */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Последние тикеты поддержки</h3>
                  <div className="space-y-2.5">
                    {supportStats.recentTickets.length === 0 ? (
                      <div className="p-6 text-center text-muted text-xs bg-[var(--surface-2)] rounded-xl">Обращений пока нет</div>
                    ) : (
                      supportStats.recentTickets.map((tk) => {
                        const isResolved = tk.status === 'resolved' || tk.status === 'closed';
                        const inProgress = tk.status === 'in_progress';
                        return (
                          <div key={tk.id} className="p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-xs">
                            <div className="flex flex-wrap justify-between items-start gap-2">
                              <div>
                                <div className="font-semibold text-sm text-[var(--text)] flex items-center gap-2">
                                  <span>{tk.name || tk.contact || 'Пользователь'}</span>
                                  {tk.contact && <span className="text-[11px] text-[var(--cobalt-text)]">{tk.contact}</span>}
                                  <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold bg-[var(--surface)] text-[var(--brand)]">
                                    {tk.category}
                                  </span>
                                </div>
                                <div className="text-[11px] text-muted mt-0.5">
                                  ID: {tk.userId || 'anon'} · Создано: {new Date(tk.createdAt).toLocaleString()}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                    isResolved
                                      ? 'bg-[var(--green-soft)] text-[var(--green)]'
                                      : inProgress
                                      ? 'bg-[var(--cobalt-soft)] text-[var(--cobalt-text)]'
                                      : 'bg-[var(--amber-soft)] text-[var(--amber)]'
                                  }`}
                                >
                                  {tk.status}
                                </span>
                                {tk.threadId && (
                                  <a
                                    href={tk.topicUrl || `https://t.me/fundingfindersupport/${tk.threadId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1 w-auto"
                                  >
                                    <span>В группу</span>
                                    <IconExternalLink size={12} />
                                  </a>
                                )}
                              </div>
                            </div>

                            <p className="text-xs text-[var(--text2)] mt-2 bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--border)]">
                              {tk.message}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
            )}
          </div>
        )}

        {/* TAB 6: ERRORS */}
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

        {/* TAB 7: LIVE STREAM AUDIT */}
        {tab === 'feed' && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="text-base font-semibold">Живой поток действий пользователей</h2>
                <p className="text-xs text-[var(--text3)]">События клиентов в реальном времени с параметрами сессий</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => liveEvents.length > 0 && exportToCsv('funding_finder_live_events.csv', liveEvents)}
                  className="btn btn-secondary text-xs py-1 px-3 w-auto flex items-center gap-1.5"
                >
                  <IconDownload size={14} /> Экспорт в CSV
                </button>
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

            {/* Category filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {['all', 'interaction', 'conversion', 'navigation', 'support', 'error'].map((c) => (
                <button
                  key={c}
                  onClick={() => setFeedCategoryFilter(c)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase ${
                    feedCategoryFilter === c ? 'bg-[var(--cobalt)] text-white' : 'bg-[var(--surface-2)] text-muted hover:text-white'
                  }`}
                >
                  {c}
                </button>
              ))}
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
                          ev.category === 'support' ? 'bg-[var(--amber-soft)] text-[var(--amber)]' :
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

        {/* TAB 8: USERS */}
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

        {/* TAB 9: WITHDRAWALS */}
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

        {/* TAB 10: LTV METRICS */}
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

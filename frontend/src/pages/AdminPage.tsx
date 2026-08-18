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
  const [tab, setTab] = useState<'users' | 'stats' | 'metrics' | 'funnel' | 'withdrawals'>('stats');
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
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
      // 403 from the backend (non-admin) — surface a clear denial state
      // instead of a silently broken empty panel.
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
    if (tab === 'withdrawals') fetchWithdrawals(withdrawalFilter);
  }, [tab, page, search, withdrawalFilter, fetchUsers, fetchStats, fetchMetrics, fetchFunnel, fetchWithdrawals]);

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
    return       <div className="p-4 text-center text-[var(--text3)]">{t('admin.loginRequired')}</div>;
  }

  if (denied) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <div className="card p-6 text-center">
          <h1 className="text-xl font-bold mb-2 text-[var(--text)]">Admin Panel</h1>
          <p className="text-sm text-[var(--red)]">{t('admin.accessDenied') || 'Access denied — this panel is for administrators only.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-2 text-[var(--text)]">Admin Panel</h1>
          <p className="text-sm text-[var(--text2)] mb-4">{t('admin.subtitle')}</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setTab('stats')}
            className={`flex-1 min-w-[100px] py-2 rounded-lg font-medium ${tab === 'stats' ? 'bg-[var(--cobalt)] text-[var(--on-brand)]' : 'bg-[var(--surface-2)] text-[var(--text3)]'}`}
          >
            {t('admin.stats')}
          </button>
          <button
            onClick={() => setTab('users')}
            className={`flex-1 min-w-[100px] py-2 rounded-lg font-medium ${tab === 'users' ? 'bg-[var(--cobalt)] text-[var(--on-brand)]' : 'bg-[var(--surface-2)] text-[var(--text3)]'}`}
          >
            {t('admin.users')}
          </button>
          <button
            onClick={() => setTab('withdrawals')}
            className={`flex-1 min-w-[100px] py-2 rounded-lg font-medium ${tab === 'withdrawals' ? 'bg-[var(--cobalt)] text-[var(--on-brand)]' : 'bg-[var(--surface-2)] text-[var(--text3)]'}`}
          >
            Выводы
          </button>
          <button
            onClick={() => setTab('metrics')}
            className={`flex-1 min-w-[100px] py-2 rounded-lg font-medium ${tab === 'metrics' ? 'bg-[var(--cobalt)] text-[var(--on-brand)]' : 'bg-[var(--surface-2)] text-[var(--text3)]'}`}
          >
            {t('admin.metrics')}
          </button>
          <button
            onClick={() => setTab('funnel')}
            className={`flex-1 min-w-[100px] py-2 rounded-lg font-medium ${tab === 'funnel' ? 'bg-[var(--cobalt)] text-[var(--on-brand)]' : 'bg-[var(--surface-2)] text-[var(--text3)]'}`}
          >
            {t('admin.funnel')}
          </button>
        </div>
      </div>

      {tab === 'stats' && stats && (
        <>
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.usersSection')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatCard value={stats.users.total} label={t('admin.total')} tone="cobalt" />
              <StatCard value={stats.users.today} label={t('admin.today')} tone="green" />
              <StatCard value={stats.users.activeWeek} label={t('admin.active7')} tone="amber" />
              <StatCard value={stats.users.activeMonth} label={t('admin.active30')} tone="cobalt" />
            </div>
            {Object.keys(stats.users.bySubscription).length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium mb-1">{t('admin.bySubscription')}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.users.bySubscription).map(([plan, count]) => (
                    <span key={plan} className="text-xs bg-[var(--surface-2)] text-[var(--text2)] px-2 py-1 rounded">{plan}: {String(count)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.finance')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatCard value={`${stats.orders.revenue.toFixed(2)} USDT`} label={t('admin.totalRevenue')} tone="green" />
              <StatCard value={`${stats.orders.revenueToday.toFixed(2)} USDT`} label={t('admin.revenueToday')} tone="cobalt" />
              <StatCard value={stats.orders.total} label={t('admin.totalOrders')} />
              <StatCard value={stats.orders.today} label={t('admin.ordersToday')} />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.system')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatCard value={formatUptime(stats.system.uptime)} label={t('admin.uptime')} size="md" />
              <StatCard value={`${stats.system.memory.heapUsed} MB`} label="Heap Used" size="md" />
              <StatCard value={`${stats.system.memory.rss} MB`} label="RSS" size="md" />
              <StatCard value={stats.system.websocket.connected} label="WebSocket" size="md" />
              <StatCard value={stats.system.cacheSize} label={t('admin.cache')} size="md" />
              <StatCard value={stats.alerts.total} label={t('admin.alerts')} size="md" />
              <StatCard value={stats.scans.totalRecords.toLocaleString()} label={t('admin.scanRecords')} size="md" />
            </div>
          </div>
        </>
      )}

      {tab === 'metrics' && metrics && (
        <>
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.acquisition')}</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <StatCard value={metrics.acquisition.newUsersToday} label={t('admin.newUsersToday')} tone="cobalt" />
              <StatCard value={metrics.acquisition.newUsers7d} label={t('admin.newUsers7d')} tone="cobalt" />
              <StatCard value={metrics.acquisition.newUsers30d} label={t('admin.newUsers30d')} tone="cobalt" />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.funnel')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatCard value={metrics.funnel.paidBase} label={t('admin.paidBase')} tone="green" />
              <StatCard value={metrics.funnel.trialActivated} label={t('admin.trialActivated')} tone="cobalt" />
              <StatCard value={metrics.funnel.paidOrders} label={t('admin.paidOrders')} />
              <StatCard value={`${metrics.funnel.trialToPaidPct}%`} label={t('admin.trialToPaid')} tone="amber" />
              <StatCard value={`${metrics.funnel.arppu.toFixed(2)} USDT`} label={t('admin.arppu')} tone="cobalt" />
              <StatCard value={`${metrics.funnel.totalRevenue.toFixed(2)} USDT`} label={t('admin.totalRevenue')} tone="green" />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.retention')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatCard value={`${metrics.retention.d7Pct}%`} label={t('admin.retentionD7')} tone="green" />
              <StatCard value={`${metrics.retention.d30Pct}%`} label={t('admin.retentionD30')} tone="green" />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.referrals')}</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <StatCard value={metrics.referrals.referredUsers} label={t('admin.referredUsers')} tone="amber" />
              <StatCard value={metrics.referrals.referredPaid} label={t('admin.referredPaid')} tone="amber" />
              <StatCard value={`${metrics.referrals.conversionPct}%`} label={t('admin.refConversion')} tone="amber" />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.source')}</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(metrics.acquisitionBySource).map(([src, count]) => (
                <span key={src} className="text-xs bg-[var(--surface-2)] text-[var(--text2)] px-2 py-1 rounded">{src}: {String(count)}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'funnel' && funnel && (
        <>
          <div className="card">
            <h2 className="text-lg font-semibold mb-1">{t('admin.funnel.eventFunnel')}</h2>
            <p className="text-xs text-[var(--text-muted)] mb-3">last {funnel.windowDays} days · {funnel.totalLandingViews} landing views</p>
            {funnel.funnel.map((s) => (
              <div key={s.stage} className="mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{t(`admin.funnel.${s.stage}`)}</span>
                  <span className="text-[var(--text-muted)]">{s.value.toLocaleString()}{s.conversionFromPrevPct < 100 && s.value > 0 ? ` · ${s.conversionFromPrevPct}%` : ''}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${funnel.totalLandingViews > 0 ? Math.max(2, (s.value / funnel.totalLandingViews) * 100) : 0}%`, background: 'var(--brand)' }} />
                </div>
              </div>
            ))}
          </div>

          {funnel.variantComparison.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">{t('admin.funnel.abTest')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-left">
                      <th className="py-1 pr-2">{t('admin.funnel.variant')}</th>
                      <th className="py-1 pr-2">{t('admin.funnel.landingView')}</th>
                      <th className="py-1 pr-2">{t('admin.funnel.appOpen')}</th>
                      <th className="py-1 pr-2">L→A%</th>
                      <th className="py-1 pr-2">{t('admin.funnel.trialStart')}</th>
                      <th className="py-1 pr-2">A→T%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.variantComparison.map((v) => (
                      <tr key={v.variant} className="border-t border-[var(--border)]">
                        <td className="py-1.5 pr-2 font-bold">{v.variant}</td>
                        <td className="py-1.5 pr-2">{v.landingView.toLocaleString()}</td>
                        <td className="py-1.5 pr-2">{v.appOpen.toLocaleString()}</td>
                        <td className="py-1.5 pr-2">{v.landingToAppPct}%</td>
                        <td className="py-1.5 pr-2">{v.trialStart.toLocaleString()}</td>
                        <td className="py-1.5 pr-2">{v.appToTrialPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 mt-3">
                {funnel.variantComparison.map((v) => (
                  <button
                    key={v.variant}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--cobalt)] text-[var(--on-brand)] active:opacity-80"
                    onClick={async () => {
                      await apiClient.post('/admin/ab/promote', { variant: v.variant });
                      showToast(`Variant ${v.variant} promoted as winner`, 'success');
                    }}
                  >
                    Promote {v.variant}
                  </button>
                ))}
                <button
                  className="text-xs px-3 py-1.5 rounded bg-[var(--surface-2)] text-[var(--text2)] active:opacity-80"
                  onClick={async () => {
                    await apiClient.post('/admin/ab/promote', { variant: null });
                    showToast('A/B test reset — random split restored', 'success');
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {Object.keys(funnel.sourceBreakdown).length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">{t('admin.funnel.bySource')}</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(funnel.sourceBreakdown).map(([src, count]) => (
                  <span key={src} className="text-xs bg-[var(--surface-2)] text-[var(--text2)] px-2 py-1 rounded">{src}: {String(count)}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'users' && (
        <div className="card">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder={t('admin.searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="input-field flex-1 text-sm"
            />
          </div>

          {loading ? (
            <div className="text-center py-8 text-[var(--text3)]">{t('common.loading')}</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-[var(--text3)]">{t('admin.noUsers')}</div>
          ) : (\n            <div className=\"space-y-2\">\n              {users.map((u) => (\n                <div key={u.telegramId} className=\"p-3 border border-[var(--border)] rounded-lg text-sm\">\n                  <div className=\"flex justify-between items-start\">\n                    <div className=\"flex-1 min-w-0\">\n                      <div className=\"font-medium truncate\">\n                        {u.firstName || u.username || u.telegramId}\n                        {u.role === 'admin' && <span className=\"ml-1 text-xs bg-[var(--red-soft)] text-[var(--red)] px-1.5 py-0.5 rounded\">admin</span>}\n                      </div>\n                      <div className=\"text-xs text-[var(--text3)] truncate\">\n                        ID: {u.telegramId} · {u.username ? `@${u.username}` : ''}\n                      </div>\n                      <div className=\"text-xs text-[var(--text3)] mt-1\">\n                        {t('admin.created', { created: new Date(u.createdAt).toLocaleDateString(), active: new Date(u.lastActive).toLocaleDateString() })}\n                      </div>\n                      <div className=\"text-xs text-[var(--text3)]\">\n                        {t('admin.counts', { orders: u._count.orders, alerts: u._count.generalAlerts + u._count.arbitrageAlerts, referrals: u._count.referrals })}\n                      </div>\n                    </div>\n                    <div className=\"text-right ml-2 flex-shrink-0\">\n                      <div className=\"font-semibold\">{u.subscription}</div>\n                      <div className=\"text-xs text-[var(--text3)]\">{u.balance} USDT</div>\n                    </div>\n                  </div>\n                  <div className=\"flex gap-1 mt-2\">\n                    <button\n                      onClick={() => setEditUser({ id: u.telegramId, field: 'subscription', value: u.subscription })}\n                      className=\"text-xs bg-[var(--cobalt-soft)] text-[var(--cobalt-text)] px-2 py-1 rounded active:opacity-80\"\n                    >\n                      {t('admin.changeSubscription')}\n                    </button>\n                    <button\n                      onClick={() => setEditUser({ id: u.telegramId, field: 'balance', value: String(u.balance) })}\n                      className=\"text-xs bg-[var(--green-soft)] text-[var(--green)] px-2 py-1 rounded active:opacity-80\"\n                    >\n                      {t('admin.changeBalance')}\n                    </button>\n                    <button\n                      onClick={() => setDeleteConfirm(u.telegramId)}\n                      className=\"text-xs bg-[var(--red-soft)] text-[var(--red)] px-2 py-1 rounded active:opacity-80 ml-auto\"\n                    >\n                      {t('common.delete')}\n                    </button>\n                  </div>\n                </div>\n              ))}\n            </div>\n          )}\n\n          {totalPages > 1 && (\n            <div className=\"flex justify-center gap-2 mt-4\">\n              <button\n                onClick={() => setPage((p) => Math.max(1, p - 1))}\n                disabled={page <= 1}\n                className=\"btn text-sm py-1 px-3 w-auto\"\n              >\n                <IconChevronLeft size={14} /> {t('admin.prev')}\n              </button>\n               <span className=\"py-1 text-sm text-[var(--text2)]\">{t('admin.page', { page, total: totalPages })}</span>\n              <button\n                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}\n                disabled={page >= totalPages}\n                className=\"btn text-sm py-1 px-3 w-auto\"\n              >\n                {t('admin.next')} <IconChevronRight size={14} />\n              </button>\n            </div>\n          )}\n        </div>\n      )}\n\n      {tab === 'withdrawals' && (\n        <div className=\"card\">\n          <div className=\"flex flex-wrap items-center justify-between gap-2 mb-4\">\n            <h2 className=\"text-lg font-semibold\">Управление выводами средств</h2>\n            <div className=\"flex gap-1 bg-[var(--surface-2)] p-1 rounded-lg\">\n              {(['pending', 'completed', 'rejected', 'all'] as const).map((st) => (\n                <button\n                  key={st}\n                  onClick={() => setWithdrawalFilter(st)}\n                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${\n                    withdrawalFilter === st\n                      ? 'bg-[var(--cobalt)] text-[var(--on-brand)]'\n                      : 'text-[var(--text2)] hover:text-[var(--text)]'\n                  }`}\n                >\n                  {st === 'pending' ? 'Ожидают' : st === 'completed' ? 'Выполнены' : st === 'rejected' ? 'Отклонены' : 'Все'}\n                </button>\n              ))}\n            </div>\n          </div>\n\n          {loading ? (\n            <div className=\"text-center py-8 text-[var(--text3)]\">{t('common.loading')}</div>\n          ) : withdrawals.length === 0 ? (\n            <div className=\"text-center py-8 text-[var(--text3)]\">Заявок на вывод не найдено</div>\n          ) : (\n            <div className=\"space-y-3\">\n              {withdrawals.map((w) => {\n                const isPending = w.status === 'pending';\n                const isCompleted = w.status === 'completed';\n                const isRejected = w.status === 'rejected';\n                const statusColor = isCompleted ? 'var(--green)' : isRejected ? 'var(--red)' : 'var(--amber)';\n                const statusBg = isCompleted ? 'var(--green-soft)' : isRejected ? 'var(--red-soft)' : 'var(--amber-soft)';\n\n                return (\n                  <div key={w.id} className=\"p-3.5 border border-[var(--border)] rounded-xl text-sm bg-[var(--surface)]\">\n                    <div className=\"flex flex-wrap justify-between items-start gap-2\">\n                      <div className=\"flex-1 min-w-[200px]\">\n                        <div className=\"font-semibold text-base\">\n                          {w.amount} {w.currency} <span className=\"text-xs px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--brand)] font-mono\">{w.network}</span>\n                        </div>\n                        <div className=\"text-xs text-[var(--text2)] mt-1\">\n                          Пользователь: <span className=\"font-medium text-[var(--text)]\">{w.user?.firstName || w.user?.username || w.userId}</span>\n                          {w.user?.username && ` (@${w.user.username})`} · Баланс: {w.user?.balance ?? 0} USDT\n                        </div>\n                        <div className=\"text-xs text-[var(--text3)] font-mono mt-1 break-all bg-[var(--surface-2)] p-1.5 rounded\">\n                          Адрес: {w.address}\n                        </div>\n                        {w.transactionId && (\n                          <div className=\"text-xs text-[var(--green)] font-mono mt-1 break-all\">\n                            TxID: {w.transactionId}\n                          </div>\n                        )}\n                        <div className=\"text-[11px] text-[var(--text3)] mt-1\">\n                          Создано: {new Date(w.createdAt).toLocaleString()}\n                        </div>\n                      </div>\n\n                      <div className=\"flex flex-col items-end gap-2\">\n                        <span\n                          className=\"text-xs px-2.5 py-1 rounded-full font-semibold\"\n                          style={{ color: statusColor, background: statusBg }}\n                        >\n                          {isPending ? 'Ожидает выплаты' : isCompleted ? 'Выплачено' : 'Отклонено'}\n                        </span>\n\n                        {isPending && (\n                          <div className=\"flex gap-1.5 mt-2\">\n                            <button\n                              onClick={() => {\n                                setCompleteModal({ id: w.id, amount: w.amount, user: w.user?.username || w.userId, address: w.address, network: w.network });\n                                setTxHash('');\n                              }}\n                              className=\"text-xs bg-[var(--green)] text-white px-3 py-1.5 rounded-lg font-semibold hover:opacity-90 active:opacity-80 transition-opacity\"\n                            >\n                              Подтвердить\n                            </button>\n                            <button\n                              onClick={() => setRejectConfirm({ id: w.id, amount: w.amount, user: w.user?.username || w.userId })}\n                              className=\"text-xs bg-[var(--red-soft)] text-[var(--red)] px-2.5 py-1.5 rounded-lg font-semibold hover:opacity-90 active:opacity-80 transition-opacity\"\n                            >\n                              Отклонить\n                            </button>\n                          </div>\n                        )}\n                      </div>\n                    </div>\n                  </div>\n                );\n              })}\n            </div>\n          )}\n        </div>\n      )}\n\n      {/* Complete Withdrawal Modal */}\n      {completeModal && (\n        <div className=\"fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4\">\n          <div className=\"bg-[var(--surface)] card rounded-xl max-w-md w-full p-5 shadow-2xl\">\n            <h2 className=\"text-lg font-bold mb-2 text-[var(--text)]\">Подтверждение выплаты</h2>\n            <p className=\"text-xs text-[var(--text2)] mb-4\">\n              Вы подтверждаете отправку <strong>{completeModal.amount} USDT</strong> пользователю {completeModal.user} в сети <strong>{completeModal.network}</strong>.\n            </p>\n\n            <div className=\"mb-4 bg-[var(--surface-2)] p-2.5 rounded-lg text-xs font-mono break-all text-[var(--text)]\">\n              {completeModal.address}\n            </div>\n\n            <div className=\"mb-4\">\n              <label className=\"block text-xs font-medium text-[var(--text2)] mb-1\">\n                Хэш транзакции (TxID / Tx Hash) — необязательно:\n              </label>\n              <input\n                type=\"text\"\n                placeholder=\"0x... или tx hash\"\n                value={txHash}\n                onChange={(e) => setTxHash(e.target.value)}\n                className=\"input-field w-full font-mono text-xs\"\n              />\n            </div>\n\n            <div className=\"flex gap-2\">\n              <button onClick={() => setCompleteModal(null)} className=\"btn btn-secondary flex-1 py-2 text-sm\">\n                Отмена\n              </button>\n              <button\n                onClick={() => handleCompleteWithdrawal(completeModal.id, txHash)}\n                className=\"btn btn-primary flex-1 py-2 text-sm font-semibold\"\n              >\n                Подтвердить перевод\n              </button>\n            </div>\n          </div>\n        </div>\n      )}\n\n      {/* Reject Withdrawal Modal */}\n      <ConfirmDialog\n        open={rejectConfirm !== null}\n        title=\"Отклонить вывод средств?\"\n        message={rejectConfirm ? `Вы уверены, что хотите отклонить заявку на ${rejectConfirm.amount} USDT? Сумма будет автоматически возвращена на баланс пользователя.` : ''}\n        confirmText=\"Отклонить и вернуть\"\n        cancelText=\"Отмена\"\n        variant=\"danger\"\n        onConfirm={handleRejectWithdrawal}\n        onCancel={() => setRejectConfirm(null)}\n      />\n\n      {editUser && (\n        <div className=\"fixed inset-0 bg-[rgba(5,7,12,0.6)] flex items-center justify-center z-50 p-4\">\n          <div className=\"bg-surface rounded-xl max-w-md w-full\" style={{ color: 'var(--text)' }}>\n            <div className=\"card\">\n              <h2 className=\"text-lg font-semibold mb-4\">\n                {editUser.field === 'subscription' ? t('admin.changeSubscription') : t('admin.editBalanceTitle')}\n              </h2>\n              {editUser.field === 'subscription' ? (\n                <select\n                  value={editUser.value}\n                  onChange={(e) => setEditUser({ ...editUser, value: e.target.value })}\n                  className=\"input-field mb-4\"\n                >\n                  <option value=\"free\">Free</option>\n                  <option value=\"pro\">Pro</option>\n                  <option value=\"proplus\">Pro+</option>\n                </select>\n              ) : (\n                <input\n                  type=\"number\"\n                  value={editUser.value}\n                  onChange={(e) => setEditUser({ ...editUser, value: e.target.value })}\n                  min={0}\n                  step={0.01}\n                  className=\"input-field mb-4\"\n                />\n              )}\n              <div className=\"flex gap-2\">\n                <button onClick={() => setEditUser(null)} className=\"btn btn-secondary flex-1\">{t('common.cancel')}</button>\n                <button\n                  onClick={() =>\n                    editUser.field === 'subscription'\n                      ? handleUpdateSubscription(editUser.id, editUser.value)\n                      : handleUpdateBalance(editUser.id, editUser.value)\n                  }\n                  className=\"btn btn-primary flex-1\"\n                >\n                  {t('common.save')}\n                </button>\n              </div>\n            </div>\n          </div>\n        </div>\n      )}\n\n      <ConfirmDialog\n        open={deleteConfirm !== null}\n        title={t('admin.deleteUserTitle')}\n        message={t('admin.deleteUserMessage')}\n        confirmText={t('common.delete')}\n        cancelText={t('common.cancel')}\n        variant=\"danger\"\n        onConfirm={handleDeleteUser}\n        onCancel={() => setDeleteConfirm(null)}\n      />\n    </div>\n  );\n}\n
import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

export function AdminPage() {
  const { user } = useApp();
  const { showToast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<'users' | 'stats' | 'metrics' | 'funnel'>('stats');
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editUser, setEditUser] = useState<{ id: string; field: 'subscription' | 'balance'; value: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res: any = await apiClient.get('/admin/stats');
      if (res.ok) setStats(res.stats);
    } catch { /* ignore */ }
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

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStats(), fetchUsers(page, search)]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'users') fetchUsers(page, search);
    if (tab === 'stats') fetchStats();
    if (tab === 'metrics') fetchMetrics();
    if (tab === 'funnel') fetchFunnel();
  }, [tab, page, search, fetchUsers, fetchStats, fetchMetrics, fetchFunnel]);

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

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return t('admin.uptimeFormat', { d, h, m });
  };

  if (!user) {
    return       <div className="p-4 text-center text-gray-500">{t('admin.loginRequired')}</div>;
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-2 text-[var(--text)]">Admin Panel</h1>
          <p className="text-sm text-gray-600 mb-4">{t('admin.subtitle')}</p>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('stats')}
            className={`flex-1 py-2 rounded-lg font-medium ${tab === 'stats' ? 'bg-[var(--brand)] text-white' : 'bg-gray-200 text-[var(--text-muted)]'}`}
          >
            {t('admin.stats')}
          </button>
          <button
            onClick={() => setTab('users')}
            className={`flex-1 py-2 rounded-lg font-medium ${tab === 'users' ? 'bg-[var(--brand)] text-white' : 'bg-gray-200 text-[var(--text-muted)]'}`}
          >
            {t('admin.users')}
          </button>
          <button
            onClick={() => setTab('metrics')}
            className={`flex-1 py-2 rounded-lg font-medium ${tab === 'metrics' ? 'bg-[var(--brand)] text-white' : 'bg-gray-200 text-[var(--text-muted)]'}`}
          >
            {t('admin.metrics')}
          </button>
          <button
            onClick={() => setTab('funnel')}
            className={`flex-1 py-2 rounded-lg font-medium ${tab === 'funnel' ? 'bg-[var(--brand)] text-white' : 'bg-gray-200 text-[var(--text-muted)]'}`}
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
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{stats.users.total}</div>
                <div className="text-blue-600">{t('admin.total')}</div>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{stats.users.today}</div>
                <div className="text-green-600">{t('admin.today')}</div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-700">{stats.users.activeWeek}</div>
                <div className="text-yellow-600">{t('admin.active7')}</div>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-700">{stats.users.activeMonth}</div>
                <div className="text-purple-600">{t('admin.active30')}</div>
              </div>
            </div>
            {Object.keys(stats.users.bySubscription).length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium mb-1">{t('admin.bySubscription')}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.users.bySubscription).map(([plan, count]) => (
                    <span key={plan} className="text-xs bg-gray-100 px-2 py-1 rounded">{plan}: {String(count)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.finance')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{stats.orders.revenue.toFixed(2)} USDT</div>
                <div className="text-green-600">{t('admin.totalRevenue')}</div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{stats.orders.revenueToday.toFixed(2)} USDT</div>
                <div className="text-blue-600">{t('admin.revenueToday')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold">{stats.orders.total}</div>
                <div className="text-gray-600">{t('admin.totalOrders')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold">{stats.orders.today}</div>
                <div className="text-gray-600">{t('admin.ordersToday')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.system')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{formatUptime(stats.system.uptime)}</div>
                <div className="text-gray-600">{t('admin.uptime')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{stats.system.memory.heapUsed} MB</div>
                <div className="text-gray-600">Heap Used</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{stats.system.memory.rss} MB</div>
                <div className="text-gray-600">RSS</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{stats.system.websocket.connected}</div>
                <div className="text-gray-600">WebSocket</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{stats.system.cacheSize}</div>
                <div className="text-gray-600">{t('admin.cache')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{stats.alerts.total}</div>
                <div className="text-gray-600">{t('admin.alerts')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-bold">{stats.scans.totalRecords.toLocaleString()}</div>
                <div className="text-gray-600">{t('admin.scanRecords')}</div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'metrics' && metrics && (
        <>
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.acquisition')}</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{metrics.acquisition.newUsersToday}</div>
                <div className="text-blue-600">{t('admin.newUsersToday')}</div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{metrics.acquisition.newUsers7d}</div>
                <div className="text-blue-600">{t('admin.newUsers7d')}</div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{metrics.acquisition.newUsers30d}</div>
                <div className="text-blue-600">{t('admin.newUsers30d')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.funnel')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{metrics.funnel.paidBase}</div>
                <div className="text-green-600">{t('admin.paidBase')}</div>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-700">{metrics.funnel.trialActivated}</div>
                <div className="text-purple-600">{t('admin.trialActivated')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold">{metrics.funnel.paidOrders}</div>
                <div className="text-gray-600">{t('admin.paidOrders')}</div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-700">{metrics.funnel.trialToPaidPct}%</div>
                <div className="text-yellow-600">{t('admin.trialToPaid')}</div>
              </div>
              <div className="p-3 bg-indigo-50 rounded-lg">
                <div className="text-2xl font-bold text-indigo-700">{metrics.funnel.arppu.toFixed(2)} USDT</div>
                <div className="text-indigo-600">{t('admin.arppu')}</div>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{metrics.funnel.totalRevenue.toFixed(2)} USDT</div>
                <div className="text-green-600">{t('admin.totalRevenue')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.retention')}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-teal-50 rounded-lg">
                <div className="text-2xl font-bold text-teal-700">{metrics.retention.d7Pct}%</div>
                <div className="text-teal-600">{t('admin.retentionD7')}</div>
              </div>
              <div className="p-3 bg-teal-50 rounded-lg">
                <div className="text-2xl font-bold text-teal-700">{metrics.retention.d30Pct}%</div>
                <div className="text-teal-600">{t('admin.retentionD30')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.referrals')}</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="p-3 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-700">{metrics.referrals.referredUsers}</div>
                <div className="text-orange-600">{t('admin.referredUsers')}</div>
              </div>
              <div className="p-3 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-700">{metrics.referrals.referredPaid}</div>
                <div className="text-orange-600">{t('admin.referredPaid')}</div>
              </div>
              <div className="p-3 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-700">{metrics.referrals.conversionPct}%</div>
                <div className="text-orange-600">{t('admin.refConversion')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('admin.metrics.source')}</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(metrics.acquisitionBySource).map(([src, count]) => (
                <span key={src} className="text-xs bg-gray-100 px-2 py-1 rounded">{src}: {String(count)}</span>
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
                    className="text-xs px-3 py-1.5 rounded bg-[var(--brand)] text-white hover:opacity-90"
                    onClick={async () => {
                      await apiClient.post('/admin/ab/promote', { variant: v.variant });
                      showToast(`Variant ${v.variant} promoted as winner`, 'success');
                    }}
                  >
                    Promote {v.variant}
                  </button>
                ))}
                <button
                  className="text-xs px-3 py-1.5 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
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
                  <span key={src} className="text-xs bg-gray-100 px-2 py-1 rounded">{src}: {String(count)}</span>
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
            <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{t('admin.noUsers')}</div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.telegramId} className="p-3 border border-gray-200 rounded-lg text-sm">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {u.firstName || u.username || u.telegramId}
                        {u.role === 'admin' && <span className="ml-1 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">admin</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        ID: {u.telegramId} · {u.username ? `@${u.username}` : ''}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {t('admin.created', { created: new Date(u.createdAt).toLocaleDateString(), active: new Date(u.lastActive).toLocaleDateString() })}
                      </div>
                      <div className="text-xs text-gray-400">
                        {t('admin.counts', { orders: u._count.orders, alerts: u._count.generalAlerts + u._count.arbitrageAlerts, referrals: u._count.referrals })}
                      </div>
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <div className="font-semibold">{u.subscription}</div>
                      <div className="text-xs text-gray-500">{u.balance} USDT</div>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-2">
                    <button
                      onClick={() => setEditUser({ id: u.telegramId, field: 'subscription', value: u.subscription })}
                      className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded hover:bg-blue-100"
                    >
                      {t('admin.changeSubscription')}
                    </button>
                    <button
                      onClick={() => setEditUser({ id: u.telegramId, field: 'balance', value: String(u.balance) })}
                      className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100"
                    >
                      {t('admin.changeBalance')}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(u.telegramId)}
                      className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100 ml-auto"
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
                ← {t('admin.prev')}
              </button>
               <span className="py-1 text-sm text-gray-600">{t('admin.page', { page, total: totalPages })}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn text-sm py-1 px-3 w-auto"
              >
                {t('admin.next')}
              </button>
            </div>
          )}
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
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
  );
}


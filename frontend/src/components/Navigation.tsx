import { memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { useT } from '../i18n';
import { useApp } from '../App';
import { Icon, type IconName } from './icons';

interface TabDef {
  path: string;
  key: string;
  icon: IconName;
  ariaLabel: string;
  badge?: (ctx: ReturnType<typeof useApp>) => number | undefined;
}

const tabs: TabDef[] = [
  { path: '/', key: 'nav.main', icon: 'Gauge', ariaLabel: 'Main page - scan funding rates' },
  { path: '/arbitrage', key: 'nav.arbitrage', icon: 'ArrowLeftRight', ariaLabel: 'Arbitrage opportunities', badge: (ctx) => {
    const count = ctx.arbAlerts?.filter((a: any) => a.isActive).length;
    return count && count > 0 ? count : undefined;
  }},
  { path: '/portfolio', key: 'nav.portfolio', icon: 'Wallet', ariaLabel: 'Portfolio simulator (Pro)' },
  { path: '/profile', key: 'nav.profile', icon: 'User', ariaLabel: 'User profile and subscriptions' },
];

export const Navigation = memo(function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const app = useApp();

  return (
      <nav
        className="web-nav"
        role="navigation"
        aria-label="Main navigation"
      >
      <div className="web-nav-inner">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          const count = tab.badge?.(app);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={clsx(
                 'web-nav-item relative px-2',
                isActive ? 'active' : ''
              )}
              aria-label={tab.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="web-nav-icon" aria-hidden="true"><Icon name={tab.icon} /></span>
              {count !== undefined && count > 0 && (
                <span className="absolute top-0 right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[var(--red-soft)] text-[var(--red)] text-[10px] font-bold px-1 leading-none">
                  {count > 99 ? '99+' : count}
                </span>
              )}
              <span className="web-nav-label">{t(tab.key)}</span>
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--cobalt-text)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
});

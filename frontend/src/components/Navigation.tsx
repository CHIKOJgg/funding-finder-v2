import { memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { useT } from '../i18n';

const tabs = [
  { path: '/', key: 'nav.main', icon: '📊', ariaLabel: 'Main page - scan funding rates' },
  { path: '/arbitrage', key: 'nav.arbitrage', icon: '🔄', ariaLabel: 'Arbitrage opportunities' },
  { path: '/portfolio', key: 'nav.portfolio', icon: '💼', ariaLabel: 'Portfolio simulator (Pro)' },
  { path: '/profile', key: 'nav.profile', icon: '👤', ariaLabel: 'User profile and subscriptions' },
];

export const Navigation = memo(function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();

  return (
      <nav
        className="web-nav"
        style={{ background: 'var(--nav-bg)', borderColor: 'var(--border)' }}
        role="navigation"
        aria-label="Main navigation"
      >
      <div className="web-nav-inner">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={clsx(
                'web-nav-item',
                isActive ? 'active' : ''
              )}
              aria-label={tab.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="web-nav-icon" aria-hidden="true">{tab.icon}</span>
              <span className="web-nav-label">{t(tab.key)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});


import { memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';

const tabs = [
  { path: '/', label: 'Главная', icon: '📊', ariaLabel: 'Main page - scan funding rates' },
  { path: '/arbitrage', label: 'Арбитраж', icon: '🔄', ariaLabel: 'Arbitrage opportunities' },
  { path: '/portfolio', label: 'Портфель', icon: '💼', ariaLabel: 'Portfolio simulator (Pro)' },
  { path: '/profile', label: 'Профиль', icon: '👤', ariaLabel: 'User profile and subscriptions' },
];

export const Navigation = memo(function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t pb-[env(safe-area-inset-bottom)]"
        style={{ background: 'var(--nav-bg)', borderColor: 'var(--border)' }}
        role="navigation"
        aria-label="Main navigation"
      >
      <div className="flex">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={clsx(
                'flex-1 py-2 flex flex-col items-center gap-1 text-xs transition-colors',
                isActive
                  ? 'text-[var(--brand)]'
                  : 'text-gray-500 hover:text-gray-700'
              )}
              aria-label={tab.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="text-xl" aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});


import { useState } from 'react';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LoginPage } from './LoginPage';

interface WebHeaderProps {
  user?: { firstName?: string; username?: string; walletAddress?: string | null; email?: string | null; provider?: string } | null;
  onLogout: () => void;
  onLogin?: (token: string, user: any) => void;
}

export function WebHeader({ user, onLogout, onLogin }: WebHeaderProps) {
  const { showToast } = useToast();
  const t = useT();
  const [showLoginModal, setShowLoginModal] = useState(false);

  const handleLogout = () => {
    onLogout();
    showToast(t('header.loggedOut') || 'Logged out', 'success');
  };

  const isGuest = !user?.provider || user.provider === 'guest';

  const displayName =
    user?.firstName ||
    (user?.walletAddress ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}` : '') ||
    user?.email ||
    (isGuest ? (t('header.guest') || 'Гость') : t('header.user'));

  return (
    <>
      <header className="web-header">
        <div className="web-header-inner">
          <div className="flex items-center gap-2">
            <span
              className="flex items-center justify-center font-mono text-[13px] font-extrabold"
              style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--cobalt)', color: 'var(--on-brand)' }}
              aria-hidden="true"
            >
              ff
            </span>
            <span className="font-extrabold text-[17px] text-[var(--text)]">Funding Finder</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm truncate max-w-[40vw]" style={{ color: 'var(--text-muted)' }}>
              {displayName}
            </span>
            <LanguageSwitcher />
            {isGuest ? (
              <button
                onClick={() => setShowLoginModal(true)}
                className="btn btn-primary text-sm py-1.5 px-3"
              >
                {t('login.login') || 'Войти'}
              </button>
            ) : (
              <button onClick={handleLogout} className="btn btn-secondary text-sm py-1.5 px-3">
                {t('header.logout') || 'Выйти'}
              </button>
            )}
          </div>
        </div>
      </header>

      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-sm my-8">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full flex items-center justify-center bg-[var(--bg1)] text-[var(--text-muted)] hover:text-[var(--text)]"
              aria-label="Close"
            >
              ✕
            </button>
            <LoginPage
              onAuthenticated={(token, u) => {
                setShowLoginModal(false);
                onLogin?.(token, u);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

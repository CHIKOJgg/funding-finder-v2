import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LoginPage } from './LoginPage';

interface WebHeaderProps {
  user?: { firstName?: string; username?: string; walletAddress?: string | null; email?: string | null; provider?: string } | null;
  onLogout: () => void;
  onLogin?: (token: string, user: any) => void;
}

export function openLoginModal() {
  window.dispatchEvent(new CustomEvent('open-login-modal'));
}

export function WebHeader({ user, onLogout, onLogin }: WebHeaderProps) {
  const { showToast } = useToast();
  const t = useT();
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const handler = () => setShowLoginModal(true);
    window.addEventListener('open-login-modal', handler);
    return () => window.removeEventListener('open-login-modal', handler);
  }, []);

  const handleLogout = () => {
    onLogout();
    showToast(t('header.loggedOut') || 'Logged out', 'success');
  };

  const isGuest = !user?.provider || user.provider === 'guest';

  const userIdentifier =
    user?.firstName ||
    (user?.walletAddress ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}` : '') ||
    user?.email ||
    '';

  return (
    <>
      <header className="web-header">
        <div className="web-header-inner">
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="flex items-center justify-center font-mono text-[13px] font-extrabold shadow-sm"
              style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--cobalt)', color: 'var(--on-brand)' }}
              aria-hidden="true"
            >
              ff
            </span>
            <span className="font-extrabold text-[16px] sm:text-[17px] tracking-tight text-[var(--text)]">
              Funding Finder
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!isGuest && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs font-medium text-[var(--text)]">
                <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                <span className="truncate max-w-[120px]">{userIdentifier || t('header.user')}</span>
              </div>
            )}

            <LanguageSwitcher />

            {isGuest ? (
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="btn btn-primary text-xs sm:text-sm py-1.5 px-3 font-semibold shadow-sm shrink-0"
              >
                {t('login.login') || 'Войти'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-secondary text-xs sm:text-sm py-1.5 px-3 font-medium shrink-0"
              >
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

import { useToast } from './Toast';
import { useT } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface WebHeaderProps {
  user?: { firstName?: string; username?: string; walletAddress?: string | null; email?: string | null; provider?: string } | null;
  onLogout: () => void;
}

export function WebHeader({ user, onLogout }: WebHeaderProps) {
  const { showToast } = useToast();
  const t = useT();

  const handleLogout = () => {
    onLogout();
    showToast(t('header.loggedOut'), 'success');
  };

  const displayName =
    user?.firstName ||
    (user?.walletAddress ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}` : '') ||
    user?.email ||
    t('header.user');

  return (
    <header className="web-header">
      <div className="web-header-inner">
        <div className="flex items-center gap-2">
          <span
            className="flex items-center justify-center font-mono text-[13px] font-extrabold"
            style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--cobalt)', color: '#FFFFFF' }}
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
          <button onClick={handleLogout} className="btn btn-secondary text-sm py-1.5 px-3">
            {t('header.logout')}
          </button>
        </div>
      </div>
    </header>
  );
}

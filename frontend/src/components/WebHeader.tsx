import { useToast } from './Toast';

interface WebHeaderProps {
  user?: { firstName?: string; username?: string; walletAddress?: string | null; email?: string | null; provider?: string } | null;
  onLogout: () => void;
}

export function WebHeader({ user, onLogout }: WebHeaderProps) {
  const { showToast } = useToast();

  const handleLogout = () => {
    onLogout();
    showToast('Вы вышли из аккаунта', 'success');
  };

  const displayName =
    user?.firstName ||
    (user?.walletAddress ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}` : '') ||
    user?.email ||
    'Пользователь';

  return (
    <header
      className="web-header"
      style={{ background: 'var(--nav-bg)', borderColor: 'var(--border)' }}
    >
      <div className="web-header-inner">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">💰</span>
          <span className="font-bold">Funding Finder</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm truncate max-w-[40vw]" style={{ color: 'var(--text-muted)' }}>
            {displayName}
          </span>
          <button onClick={handleLogout} className="btn btn-secondary text-sm py-1.5 px-3">
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}

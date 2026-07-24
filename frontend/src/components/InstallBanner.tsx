import { useState, useEffect } from 'react';
import { useT } from '../i18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallBanner() {
  const t = useT();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (!deferredPrompt || dismissed) return null;

  return (
    <div
      className="rounded-xl p-3 mb-3 flex items-center gap-3 border"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--brand-soft)',
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
        style={{ background: 'var(--brand)' }}
      >
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{t('install.title')}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('install.desc')}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={handleInstall} className="btn btn-primary text-sm py-1.5 px-3">
          {t('install.install')}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-sm px-2 py-1.5 rounded-lg"
          style={{ color: 'var(--text-muted)' }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
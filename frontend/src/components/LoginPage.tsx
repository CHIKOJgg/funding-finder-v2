import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
import { useT } from '../i18n';

interface LoginProps {
  onAuthenticated: (token: string, user: any) => void;
}

function buildSiweMessage(opts: {
  domain: string;
  address: string;
  chainId: number;
  nonce: string;
  uri: string;
}): string {
  const issuedAt = new Date().toISOString();
  return [
    `${opts.domain} wants you to sign in with your Ethereum account:`,
    opts.address,
    '',
    'Sign in to Funding Finder.',
    '',
    `URI: ${opts.uri}`,
    `Version: 1`,
    `Chain ID: ${opts.chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById('google-gsi');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      return;
    }
    const s = document.createElement('script');
    s.id = 'google-gsi';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.body.appendChild(s);
  });
}

export function LoginPage({ onAuthenticated }: LoginProps) {
  const { showToast } = useToast();
  const t = useT();
  const [config, setConfig] = useState<{ googleEnabled?: boolean; googleClientId?: string; siweDomain?: string; simulation?: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiClient.getAuthConfig()
      .then((r: any) => { if (r?.ok) setConfig(r); })
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    if (!config.googleEnabled || !config.googleClientId || !googleBtnRef.current) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !googleBtnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: (resp: any) => {
            if (resp?.credential) handleGoogle(resp.credential);
          },
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          width: googleBtnRef.current.clientWidth || 280,
        });
      })
      .catch(() => showToast(t('login.googleLoadError'), 'error'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.googleEnabled, config.googleClientId]);

  const handleWallet = async () => {
    try {
      if (!window.ethereum) {
        showToast(t('login.installWallet'), 'error');
        return;
      }
      setLoading(true);
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      if (!address) throw new Error(t('login.walletNoAddress'));

      const cfg: any = await apiClient.getAuthConfig();
      const domain = cfg?.siweDomain || window.location.host;

      const nonceRes: any = await apiClient.walletNonce(address);
      if (!nonceRes?.ok) throw new Error(t('login.nonceError'));

      let chainId = 1;
      try {
        const hex = await window.ethereum.request({ method: 'eth_chainId' });
        chainId = parseInt(hex, 16) || 1;
      } catch { /* keep default */ }

      const message = buildSiweMessage({
        domain,
        address,
        chainId,
        nonce: nonceRes.nonce,
        uri: window.location.origin,
      });

      const signature: string = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      });

      const verifyRes: any = await apiClient.walletVerify(message, signature);
      if (verifyRes?.ok) {
        showToast(t('login.success'), 'success');
        onAuthenticated(verifyRes.token, verifyRes.user);
      } else {
        throw new Error(t('login.signatureFailed'));
      }
    } catch (err) {
      showToast(t('login.walletError') + (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (idToken: string) => {
    try {
      setGoogleLoading(true);
      const res: any = await apiClient.googleLogin(idToken);
      if (res?.ok) {
        showToast(t('login.success'), 'success');
        onAuthenticated(res.token, res.user);
      } else {
        throw new Error(res?.error || t('login.googleFailed'));
      }
    } catch (err) {
      showToast(t('login.googleError') + (err as Error).message, 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDevGuest = async () => {
    try {
      setLoading(true);
      const res: any = await apiClient.devGuest();
      if (res?.ok) onAuthenticated(res.token, res.user);
    } catch (err) {
      showToast(t('login.devError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-lg" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
        <div className="text-center mb-6">
          <div className="text-4xl mb-2" aria-hidden="true">💰</div>
          <h1 className="text-xl font-bold text-[var(--text)]">Funding Finder</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('login.subtitle')}
          </p>
        </div>

        {config.googleEnabled ? (
          <div className="mb-3">
            <div ref={googleBtnRef} className="flex justify-center" />
            {googleLoading && <div className="text-center text-sm mt-2" style={{ color: 'var(--text-muted)' }}>{t('login.checking')}</div>}
          </div>
        ) : (
          <p className="text-center text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {t('login.googleUnavailable')}
          </p>
        )}

        <button
          onClick={handleWallet}
          disabled={loading}
          className="btn btn-secondary w-full mb-3 text-base py-3"
        >
            {loading ? t('login.walletBtnLoading') : t('login.walletBtn')}
        </button>

        {config.simulation && (
          <p className="text-center text-xs mb-3" style={{ color: 'var(--brand)' }}>
            {t('login.demoMode')}
          </p>
        )}

        {import.meta.env.DEV && (
          <button onClick={handleDevGuest} disabled={loading} className="btn btn-secondary w-full text-sm">
              {t('login.devGuest')}
          </button>
        )}

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
            {t('login.footerNote')}
        </p>
      </div>
    </div>
  );
}

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

type AuthMode = 'login' | 'register';

export function LoginPage({ onAuthenticated }: LoginProps) {
  const { showToast } = useToast();
  const t = useT();
  const [config, setConfig] = useState<{ googleEnabled?: boolean; googleClientId?: string; siweDomain?: string; simulation?: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  // Email / password state
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

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

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      showToast(t('login.emailError'), 'error');
      return;
    }
    if (password.length < 8) {
      showToast(t('login.passwordError'), 'error');
      return;
    }

    setEmailLoading(true);
    try {
      if (mode === 'register') {
        const res: any = await apiClient.emailRegister(trimmedEmail, password, firstName.trim() || undefined);
        if (res?.ok) {
          showToast(t('login.registerSuccess'), 'success');
          onAuthenticated(res.token, res.user);
        } else {
          throw new Error(res?.error || t('login.registerError'));
        }
      } else {
        const res: any = await apiClient.emailLogin(trimmedEmail, password);
        if (res?.ok) {
          showToast(t('login.success'), 'success');
          onAuthenticated(res.token, res.user);
        } else {
          throw new Error(res?.error || t('login.loginError'));
        }
      }
    } catch (err) {
      const prefix = mode === 'register' ? t('login.registerError') : t('login.loginError');
      showToast(prefix + (err as Error).message, 'error');
    } finally {
      setEmailLoading(false);
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

        {/* Email / password form */}
        <form onSubmit={handleEmailSubmit} className="mb-4">
          <div className="flex gap-2 mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border, #e5e7eb)' }}>
            <button
              type="button"
              onClick={() => setMode('login')}
              className="flex-1 py-2 text-sm font-medium transition-colors"
              style={{
                background: mode === 'login' ? 'var(--brand, #3390ec)' : 'transparent',
                color: mode === 'login' ? '#fff' : 'var(--text)',
              }}
            >
              {t('login.login')}
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className="flex-1 py-2 text-sm font-medium transition-colors"
              style={{
                background: mode === 'register' ? 'var(--brand, #3390ec)' : 'transparent',
                color: mode === 'register' ? '#fff' : 'var(--text)',
              }}
            >
              {t('login.register')}
            </button>
          </div>

          {mode === 'register' && (
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t('login.namePlaceholder')}
              className="w-full mb-2 px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--input-bg, #f3f4f6)', color: 'var(--text)', border: '1px solid var(--border, #e5e7eb)' }}
            />
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('login.emailPlaceholder')}
            required
            autoComplete="email"
            className="w-full mb-2 px-3 py-2.5 rounded-lg text-sm"
            style={{ background: 'var(--input-bg, #f3f4f6)', color: 'var(--text)', border: '1px solid var(--border, #e5e7eb)' }}
          />

          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              required
              minLength={8}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="w-full px-3 py-2.5 rounded-lg text-sm pr-10"
              style={{ background: 'var(--input-bg, #f3f4f6)', color: 'var(--text)', border: '1px solid var(--border, #e5e7eb)' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-xs opacity-50 hover:opacity-100"
              style={{ color: 'var(--text-muted)' }}
              tabIndex={-1}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>

          <button
            type="submit"
            disabled={emailLoading || loading}
            className="btn btn-primary w-full mt-3 text-sm py-2.5"
          >
            {emailLoading
              ? t('login.checking')
              : mode === 'register'
                ? t('login.registerBtn')
                : t('login.loginBtn')}
          </button>
        </form>

        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 h-px" style={{ background: 'var(--border, #e5e7eb)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('login.orEmail')}</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border, #e5e7eb)' }} />
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

import { useState, useEffect, useCallback, memo } from 'react';
import QRCode from 'qrcode';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
import { IconCheckCircle2, IconLoader2, IconSmartphone, IconX } from './icons';

interface Props {
  onClose: () => void;
}

const SCAN_URL_BASE = 'https://funding-finder-frontend.onrender.com/qr-scan';

export const QrLoginModal = memo(function QrLoginModal({ onClose }: Props) {
  const { showToast } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'error'>('loading');
  const [countdown, setCountdown] = useState(300);

  // Generate QR token
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.qrLoginRequest();
        if (cancelled || !res?.ok) return;
        setToken(res.token);
        setExpiresAt(res.expiresAt);
        setCountdown(Math.ceil((res.expiresAt - Date.now()) / 1000));

        // Generate QR code as data URL
       const scanUrl = `${SCAN_URL_BASE}#token=${res.token}`;
        const dataUrl = await QRCode.toDataURL(scanUrl, {
          width: 256,
          margin: 2,
          color: { dark: '#05070C', light: '#ffffff' },
        });
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setStatus('waiting');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll for scan confirmation
  useEffect(() => {
    if (status !== 'waiting' || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.qrLoginStatus(token);
        if (cancelled) return;
        if (res?.consumed) {
          setStatus('scanned');
          showToast('Desktop logged in!', 'success');
          setTimeout(onClose, 2000);
        } else {
          setStatus('error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [status, token, showToast, onClose]);

  // Countdown timer
  useEffect(() => {
    if (expiresAt === 0) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        setStatus('error');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const handleRefresh = useCallback(async () => {
    setStatus('loading');
    setQrDataUrl('');
    setToken('');
    setExpiresAt(0);
    try {
      const res = await apiClient.qrLoginRequest();
      if (!res?.ok) return;
      setToken(res.token);
      setExpiresAt(res.expiresAt);
      setCountdown(Math.ceil((res.expiresAt - Date.now()) / 1000));
       const scanUrl = `${SCAN_URL_BASE}#token=${res.token}`;
      const dataUrl = await QRCode.toDataURL(scanUrl, {
        width: 256, margin: 2,
        color: { dark: '#05070C', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setStatus('waiting');
    } catch {
      setStatus('error');
    }
  }, []);

  const expired = countdown <= 0;

  return (
    <div
      className="fixed inset-0 bg-[rgba(5,7,12,0.6)] flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5 animate-slide-in"
        style={{ background: 'var(--surface)', color: 'var(--text)', maxWidth: 380, textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <IconSmartphone size={20} style={{ color: 'var(--brand)' }} /> QR Login
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
            aria-label="Close"
          >
            <IconX size={16} />
          </button>
        </div>

        {status === 'loading' && (
          <div style={{ padding: 40 }}>
            <div className="flex justify-center">
              <IconLoader2 size={32} className="animate-spin" style={{ color: 'var(--brand)' }} />
            </div>
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Generating QR code...</p>
          </div>
        )}

        {status === 'waiting' && qrDataUrl && (
          <>
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Scan this QR code with your desktop browser to log in</p>
            <div style={{ background: '#fff', display: 'inline-block', padding: 12, borderRadius: 12 }}>
              <img src={qrDataUrl} alt="QR Login" style={{ width: 256, height: 256, display: 'block' }} />
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              {expired ? (
                <span style={{ color: 'var(--red)' }}>QR code expired</span>
              ) : (
                <>Expires in <strong className="font-mono tabular-nums" style={{ color: 'var(--brand)' }}>{countdown}s</strong></>
              )}
            </p>
            {expired && (
              <button onClick={handleRefresh} className="btn btn-primary mt-2" style={{ width: '100%' }}>
                Generate new QR code
              </button>
            )}
          </>
        )}

        {status === 'scanned' && (
          <div style={{ padding: 40 }}>
            <div className="flex justify-center mb-3">
              <IconCheckCircle2 size={48} style={{ color: 'var(--green)' }} />
            </div>
            <p className="font-bold">Desktop browser logged in!</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You can close this modal</p>
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>Failed to generate QR code</p>
            <button onClick={handleRefresh} className="btn btn-primary mt-2" style={{ width: '100%' }}>
              Try again
            </button>
          </div>
        )}

        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          Open the QR scan page on your desktop: <strong>/qr-scan</strong>
        </p>
      </div>
    </div>
  );
});

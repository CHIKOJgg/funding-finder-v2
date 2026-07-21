import { useState, useEffect, useCallback, memo } from 'react';
import QRCode from 'qrcode';
import { apiClient } from '../api/client';
import { useToast } from './Toast';

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
        const scanUrl = `${SCAN_URL_BASE}?token=${res.token}`;
        const dataUrl = await QRCode.toDataURL(scanUrl, {
          width: 256,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
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
      const scanUrl = `${SCAN_URL_BASE}?token=${res.token}`;
      const dataUrl = await QRCode.toDataURL(scanUrl, {
        width: 256, margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setStatus('waiting');
    } catch {
      setStatus('error');
    }
  }, []);

  const expired = countdown <= 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>📱 QR Login</h3>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 14 }}>✕</button>
        </div>

        {status === 'loading' && (
          <div style={{ padding: 40 }}>
            <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto' }} />
            <p className="text-muted mt-2">Generating QR code...</p>
          </div>
        )}

        {status === 'waiting' && qrDataUrl && (
          <>
            <p className="text-sm text-muted mb-3">Scan this QR code with your desktop browser to log in</p>
            <div style={{ background: '#fff', display: 'inline-block', padding: 12, borderRadius: 12 }}>
              <img src={qrDataUrl} alt="QR Login" style={{ width: 256, height: 256, display: 'block' }} />
            </div>
            <p className="text-xs text-muted mt-2">
              {expired ? (
                <span style={{ color: 'var(--danger)' }}>QR code expired</span>
              ) : (
                <>Expires in <strong>{countdown}s</strong></>
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
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <p className="font-bold">Desktop browser logged in!</p>
            <p className="text-sm text-muted">You can close this modal</p>
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 40 }}>
            <p className="text-muted">Failed to generate QR code</p>
            <button onClick={handleRefresh} className="btn btn-primary mt-2" style={{ width: '100%' }}>
              Try again
            </button>
          </div>
        )}

        <p className="text-xs text-muted mt-3">
          Open the QR scan page on your desktop: <strong>/qr-scan</strong>
        </p>
      </div>
    </div>
  );
});

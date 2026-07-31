import { useState, useEffect, memo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { IconCheckCircle2, IconXCircle } from '../components/icons';

export const QrScanPage = memo(function QrScanPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No token provided. Open this page by scanning a QR code from the Mini App.');
      return;
    }

    setStatus('verifying');
    (async () => {
      try {
        const res: any = await apiClient.qrLoginVerify(token);
        if (res?.ok && res.authToken) {
          // Store the JWT token for authenticated API calls
          localStorage.setItem('ff_auth_token', res.authToken);
          localStorage.setItem('ff_user_id', res.userId);
          setStatus('success');
        } else {
          setStatus('error');
          setError(res?.error || 'Verification failed');
        }
      } catch (e: any) {
        setStatus('error');
        setError(e?.response?.data?.error || e.message || 'Network error');
      }
    })();
  }, [token]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg1)',
      color: 'var(--text)',
    }}>
      <div style={{
        maxWidth: 420,
        width: '100%',
        padding: 32,
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          Funding<span style={{ color: 'var(--cobalt-text)' }}>Finder</span>
        </h1>

        {status === 'idle' && (
          <p style={{ color: 'var(--text2)' }}>Loading...</p>
        )}

        {status === 'verifying' && (
          <>
            <div style={{
              width: 48, height: 48, border: '3px solid var(--cobalt)',
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '24px auto',
            }} />
            <p style={{ color: 'var(--text2)' }}>Verifying QR code...</p>
          </>
        )}

        {status === 'success' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <IconCheckCircle2 size={64} style={{ color: 'var(--green)' }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Logged in!</h2>
            <p style={{ color: 'var(--text2)', marginBottom: 24 }}>
              Your desktop browser is now connected to Funding Finder.
            </p>
            <a
              href="/"
              style={{
                display: 'inline-block',
                padding: '12px 32px',
                background: 'var(--cobalt)',
                color: 'var(--on-brand)',
                borderRadius: 12,
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              Open Funding Finder →
            </a>
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <IconXCircle size={64} style={{ color: 'var(--red)' }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Verification failed</h2>
            <p style={{ color: 'var(--red)', marginBottom: 16, fontSize: 14 }}>{error}</p>
            <p style={{ color: 'var(--text2)', fontSize: 13 }}>
              Go back to the Mini App and generate a new QR code.
            </p>
          </div>
        )}

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
});

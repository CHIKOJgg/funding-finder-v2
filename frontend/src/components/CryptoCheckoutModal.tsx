import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { track } from '../utils/analytics';

interface CryptoCheckoutModalProps {
  open: boolean;
  planId: string;
  planName: string;
  price: number;
  onClose: () => void;
  onPaid: () => void;
}

const CURRENCIES = [
  { code: 'usdterc20', label: 'USDT (ERC-20)', icon: '🔷' },
  { code: 'usdttrc20', label: 'USDT (TRC-20)', icon: '🔶' },
  { code: 'usdtbsc', label: 'USDT (BEP-20)', icon: '🟡' },
  { code: 'usdc', label: 'USDC', icon: '💠' },
  { code: 'eth', label: 'ETH', icon: '⬡' },
  { code: 'btc', label: 'BTC', icon: '₿' },
  { code: 'sol', label: 'SOL', icon: '◎' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'crypto.statusPending',
  waiting: 'crypto.statusPending',
  confirming: 'crypto.statusConfirming',
  paid: 'crypto.statusPaid',
  finished: 'crypto.statusPaid',
  failed: 'crypto.statusFailed',
  expired: 'crypto.statusExpired',
};

export function CryptoCheckoutModal({ open, planId, planName, price, onClose, onPaid }: CryptoCheckoutModalProps) {
  const { showToast } = useToast();
  const t = useT();
  const [currency, setCurrency] = useState('usdterc20');
  const [creating, setCreating] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [status, setStatus] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const paidFiredRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    stopPolling();
    setOrder(null);
    setStatus('');
    setCopied(false);
    paidFiredRef.current = false;
    onClose();
  }, [onClose, stopPolling]);

  const orderIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!order?.orderId) return;
    orderIdRef.current = order.orderId;
  }, [order?.orderId]);

  useEffect(() => {
    const oid = order?.orderId;
    if (!oid) return;

    const tick = async () => {
      try {
        const res: any = await apiClient.getOrderStatus(oid);
        const st = res?.order?.status || res?.invoice?.status || '';
        setStatus(st);
        if (st === 'paid' || st === 'finished') {
          stopPolling();
          if (!paidFiredRef.current) {
            paidFiredRef.current = true;
            showToast(t('crypto.subscriptionActivated'), 'success');
            track('paid', { plan: planId });
            onPaid();
            setTimeout(close, 1200);
          }
        } else if (st === 'failed' || st === 'expired') {
          stopPolling();
          showToast(t('crypto.statusFailed'), 'error');
        }
      } catch {
        /* ignore transient errors */
      }
    };

    tick();
    pollRef.current = setInterval(tick, 3000);
    return stopPolling;
  }, [order?.orderId, onPaid, close, showToast, stopPolling, planId]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const createPayment = async () => {
    try {
      setCreating(true);
      const res: any = await apiClient.createOrder(planId, { provider: 'nowpayments', payCurrency: currency });
      if (res?.ok) {
        setOrder(res);
        setStatus(res.status || 'waiting');
        if (res.invoiceUrl) {
          window.open(res.invoiceUrl, '_blank');
        }
        if (res.simulated) {
          showToast(t('crypto.demoModeToast'), 'success');
        } else {
          showToast(t('crypto.invoiceCreated'), 'success');
        }
      } else {
        throw new Error(res?.error || t('crypto.invoiceCreateError'));
      }
    } catch (err) {
      showToast(t('crypto.errorPrefix') + (err as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const simulate = async () => {
    if (!order?.orderId) return;
    try {
      const res: any = await apiClient.simulatePayment(order.orderId);
      if (res?.ok) {
        setStatus('paid');
      }
    } catch (err) {
      showToast(t('crypto.simError'), 'error');
    }
  };

  const copyAddress = async () => {
    if (!order?.payAddress) return;
    try {
      await navigator.clipboard.writeText(order.payAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  if (!open) return null;

  const isWaiting = status === 'pending' || status === 'waiting' || status === 'confirming';
  const isPaid = status === 'paid' || status === 'finished';
  const isFailed = status === 'failed' || status === 'expired';
  const progressPct = isPaid ? 100 : isWaiting ? 45 : 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 animate-slide-in"
        style={{ background: 'var(--surface)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1">{t('crypto.title')}</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
           {t('crypto.planLine', { plan: planName, price })}
         </p>

        {!order ? (
          <>
            <label className="text-sm font-medium mb-2 block">{t('crypto.selectCoin')}</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => setCurrency(c.code)}
                  className="flex items-center gap-2 rounded-xl p-2.5 text-sm font-medium transition-all"
                  style={{
                    background: currency === c.code ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: currency === c.code ? '1px solid var(--brand)' : '1px solid transparent',
                    color: currency === c.code ? 'var(--brand)' : 'var(--text)',
                  }}
                >
                  <span className="text-lg">{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <button onClick={createPayment} disabled={creating} className="btn btn-primary w-full mb-2">
              {creating ? t('crypto.creatingInvoice') : t('crypto.createInvoice')}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            {/* Progress bar */}
            {status && (
              <div className="mb-2">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${progressPct}%`,
                      background: isPaid ? 'var(--green, #16a34a)' : isFailed ? '#ef4444' : 'var(--brand)',
                      animation: isWaiting ? 'pulse 1.5s ease-in-out infinite' : 'none',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Status badge */}
            <div
              className="rounded-xl p-3 text-center text-sm font-semibold"
              style={{
                background: isPaid ? 'var(--success-soft, #dcfce7)' : isFailed ? '#fee2e2' : 'var(--surface-2)',
                color: isPaid ? 'var(--success, #15803d)' : isFailed ? '#b91c1c' : 'var(--text)',
              }}
            >
              {isWaiting && (
                <span className="inline-block mr-2 animate-pulse">⏳</span>
              )}
              {isPaid && <span className="inline-block mr-2">✅</span>}
              {isFailed && <span className="inline-block mr-2">❌</span>}
              {t(STATUS_LABEL[status] || 'crypto.statusProcessing')}
            </div>

            {order.invoiceUrl && !order.simulated && (
              <a href={order.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-primary w-full block text-center">
                {t('crypto.openPaymentPage')}
              </a>
            )}

            {/* QR Code area */}
            {order.payAddress && order.payAddress !== 'SIM_WALLET_ADDRESS' && (
              <div className="rounded-xl p-4 text-center" style={{ background: 'var(--surface-2)' }}>
                <div className="flex justify-center mb-3">
                  <div
                    id="payment-qr"
                    className="w-40 h-40 rounded-xl bg-white flex items-center justify-center"
                    style={{ padding: '8px' }}
                  >
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(order.payAddress)}`}
                      alt="QR code"
                      className="w-full h-full"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  {t('crypto.depositAddress', { currency: order.payCurrency })}
                </div>
                <div className="font-mono text-sm break-all select-all bg-white dark:bg-gray-800 rounded-lg p-2 mb-2">
                  {order.payAddress}
                </div>
                <div className="flex gap-2">
                  <button onClick={copyAddress} className="btn btn-secondary text-xs py-1.5 flex-1">
                    {copied ? t('crypto.copied') : t('crypto.copyAddress')}
                  </button>
                  <button
                    onClick={() => {
                      if (order.payCurrency?.startsWith('usdt')) {
                        const botLink = 'https://t.me/CryptoBot';
                        window.open(botLink, '_blank');
                      }
                    }}
                    className="btn btn-primary text-xs py-1.5 flex-1"
                  >
                    {t('crypto.openCryptoBot') || 'Open Crypto Bot'}
                  </button>
                </div>
                {order.payAmount != null && (
                  <div className="text-sm font-semibold mt-2">
                    {t('crypto.amount', { amount: order.payAmount, currency: order.payCurrency })}
                  </div>
                )}
              </div>
            )}

            {order.simulated && (
              <button onClick={simulate} className="btn btn-primary w-full">
                 {t('crypto.simulatePayment')}
              </button>
            )}

            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              {t('crypto.statusAutoNote')}
            </p>
          </div>
        )}

        <button onClick={close} className="btn btn-secondary w-full mt-3">
          {order ? t('crypto.close') : t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
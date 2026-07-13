import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
import { useT } from '../i18n';

interface CryptoCheckoutModalProps {
  open: boolean;
  planId: string;
  planName: string;
  price: number;
  onClose: () => void;
  onPaid: () => void;
}

const CURRENCIES = [
  { code: 'usdterc20', label: 'USDT (Ethereum ERC-20)' },
  { code: 'usdttrc20', label: 'USDT (Tron TRC-20)' },
  { code: 'usdtbsc', label: 'USDT (BNB BEP-20)' },
  { code: 'usdc', label: 'USDC (Ethereum)' },
  { code: 'eth', label: 'ETH' },
  { code: 'btc', label: 'BTC' },
  { code: 'sol', label: 'SOL' },
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
  const [status, setStatus] = useState<string>(''); // local mirror for display
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

  // Poll order status while an order is open and not yet paid/failed.
  useEffect(() => {
    if (!order?.orderId) return;
    if (status === 'paid' || status === 'failed' || status === 'expired') return;

    const tick = async () => {
      try {
        const res: any = await apiClient.getOrderStatus(order.orderId);
        const st = res?.order?.status || res?.invoice?.status || status;
        setStatus(st);
        if (st === 'paid' || st === 'finished') {
          stopPolling();
          if (!paidFiredRef.current) {
            paidFiredRef.current = true;
            showToast(t('crypto.subscriptionActivated'), 'success');
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
  }, [order, status, onPaid, close, showToast, stopPolling]);

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
            <label className="text-sm font-medium mb-1 block">{t('crypto.selectCoin')}</label>
            <select
              className="input-field w-full mb-4"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <button onClick={createPayment} disabled={creating} className="btn btn-primary w-full mb-2">
              {creating ? t('crypto.creatingInvoice') : t('crypto.createInvoice')}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div
              className="rounded-xl p-3 text-center text-sm font-semibold"
              style={{
                background: status === 'paid' ? 'var(--success-soft)' : 'var(--surface-2)',
                color: status === 'paid' ? 'var(--success)' : 'var(--text)',
              }}
            >
              {t(STATUS_LABEL[status] || 'crypto.statusProcessing')}
            </div>

            {order.invoiceUrl && !order.simulated && (
              <a href={order.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-primary w-full block text-center">
                {t('crypto.openPaymentPage')}
              </a>
            )}

            {order.payAddress && order.payAddress !== 'SIM_WALLET_ADDRESS' && (
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                   {t('crypto.depositAddress', { currency: order.payCurrency })}
                </div>
                <div className="font-mono text-sm break-all select-all mt-1">{order.payAddress}</div>
                <button onClick={copyAddress} className="btn btn-secondary text-xs mt-2 py-1.5">
                  {copied ? t('crypto.copied') : t('crypto.copyAddress')}
                </button>
                {order.payAmount != null && (
                  <div className="text-sm mt-2">
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

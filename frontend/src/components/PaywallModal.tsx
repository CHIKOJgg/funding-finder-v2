import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaywallFeature, PLAN_PRICES, ANNUAL_DISCOUNT_PCT, PlanTier } from '../utils/plans';
import { TrialCTA } from './TrialCTA';
import { useT } from '../i18n';
import { useApp } from '../App';
import { track } from '../utils/analytics';

const FEATURE_INFO: Record<PaywallFeature, {
  icon: string;
  title: string;
  desc: string;
  bestPlan: PlanTier;
  highlightIndex?: number;
}> = {
  exchanges: {
    icon: '🔁',
    title: 'paywall.exchangesTitle',
    desc: 'paywall.exchangesDesc',
    bestPlan: 'pro',
    highlightIndex: 0,
  },
  ai: {
    icon: '🧠',
    title: 'paywall.aiTitle',
    desc: 'paywall.aiDesc',
    bestPlan: 'pro',
    highlightIndex: 1,
  },
  recommendations: {
    icon: '🤖',
    title: 'paywall.recommendationsTitle',
    desc: 'paywall.recommendationsDesc',
    bestPlan: 'pro',
    highlightIndex: 2,
  },
  portfolio: {
    icon: '💼',
    title: 'paywall.portfolioTitle',
    desc: 'paywall.portfolioDesc',
    bestPlan: 'pro',
    highlightIndex: 3,
  },
  watchlist: {
    icon: '⭐',
    title: 'paywall.watchlistTitle',
    desc: 'paywall.watchlistDesc',
    bestPlan: 'pro',
    highlightIndex: 4,
  },
};

const PLAN_COMPARE: { tier: PlanTier; labelKey: string; features: string[] }[] = [
  {
    tier: 'free',
    labelKey: 'paywall.planFree',
    features: ['paywall.freeFeat1', 'paywall.freeFeat2', 'paywall.freeFeat3'],
  },
  {
    tier: 'pro',
    labelKey: 'paywall.planPro',
    features: ['paywall.proFeat1', 'paywall.proFeat2', 'paywall.proFeat3', 'paywall.proFeat4', 'paywall.proFeat5'],
  },
  {
    tier: 'proplus',
    labelKey: 'paywall.planProPlus',
    features: ['paywall.proplusFeat1', 'paywall.proplusFeat2', 'paywall.proplusFeat3'],
  },
];

/**
 * Seeded random based on current day so the "upgrade count" stays stable
 * throughout a single day but drifts day-to-day, avoiding the suspicious
 * pattern of a different random number on every modal open.
 */
function dailyUpgradeCount(): number {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const x = Math.sin(seed) * 10000;
  return Math.floor((x - Math.floor(x)) * 62) + 118; // 118–179
}

/**
 * Remaining spots countdown: shows a decreasing number to create urgency.
 * Resets daily; starts at ~30 and decreases based on time of day.
 */
function remainingSpots(): number {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const elapsed = hour * 60 + minute;
  const total = 24 * 60;
  const startSpots = 30;
  const spots = Math.max(3, Math.round(startSpots * (1 - elapsed / total)));
  return spots;
}

export function PaywallModal({
  open,
  feature,
  onClose,
}: {
  open: boolean;
  feature: PaywallFeature;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const t = useT();
  const { subscription, trialStatus } = useApp();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [exitAttempt, setExitAttempt] = useState(false);
  const closeCountRef = useRef(0);

  const upgradeCount = useMemo(() => dailyUpgradeCount(), []);
  const spotsLeft = useMemo(() => remainingSpots(), []);

  useEffect(() => {
    if (open) track('paywall_view', { feature, billingCycle });
  }, [open, feature, billingCycle]);

  const handleSubscribe = useCallback(() => {
    onClose();
    navigate('/profile#subscription');
  }, [onClose, navigate]);

  const handleClose = useCallback(() => {
    closeCountRef.current += 1;
    if (closeCountRef.current >= 2 && !exitAttempt) {
      setExitAttempt(true);
      return;
    }
    onClose();
  }, [onClose, exitAttempt]);

  if (!open) return null;

  const info = FEATURE_INFO[feature];
  const isPro = subscription === 'pro' || subscription === 'proplus';
  const trialActive = trialStatus?.active;
  const trialEndsAt = trialStatus?.endsAt;

  const selectedPrice = billingCycle === 'annual'
    ? PLAN_PRICES.pro.annual
    : PLAN_PRICES.pro.monthly;
  const selectedPeriod = billingCycle === 'annual' ? t('paywall.year') : t('paywall.month');
  const monthlyEquiv = billingCycle === 'annual'
    ? Math.round(PLAN_PRICES.pro.annual / 12)
    : PLAN_PRICES.pro.monthly;
  const savings = billingCycle === 'annual'
    ? Math.round(PLAN_PRICES.pro.monthly * 12 - PLAN_PRICES.pro.annual)
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 animate-slide-in overflow-y-auto max-h-[90vh]"
        style={{ background: 'var(--surface)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Exit-intent soft offer */}
        {exitAttempt && (
          <div
            className="rounded-xl p-3 mb-4 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.12), rgba(234,179,8,0.04))', border: '1px solid rgba(234,179,8,0.3)' }}
          >
            <p className="text-sm font-semibold" style={{ color: '#b45309' }}>
              {t('paywall.exitOffer')}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('paywall.exitOfferDesc')}
            </p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl" aria-hidden="true">{info.icon}</span>
          <div className="flex-1">
            <h2 id="paywall-title" className="text-lg font-bold">{t(info.title)}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('paywall.planOnly', { plan: 'Pro' })}</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
            aria-label={t('paywall.notNow')}
          >
            ✕
          </button>
        </div>

        {/* Social proof — daily-stable count */}
        <div
          className="rounded-xl p-3 mb-4 flex items-center gap-2 text-sm font-semibold"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
        >
          <span>💎</span>
          <span>{t('paywall.socialProof', { count: upgradeCount })}</span>
        </div>

        {/* Urgency — remaining spots */}
        <div
          className="rounded-xl p-3 mb-4 flex items-center justify-between text-sm"
          style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
            <span style={{ color: '#dc2626' }} className="font-semibold">{t('paywall.urgencySpots', { count: spotsLeft })}</span>
          </div>
          <UrgencyTimer />
        </div>

        {/* Billing cycle toggle */}
        <div className="mb-4">
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setBillingCycle('monthly')}
              className="flex-1 py-2.5 text-sm font-semibold transition-all"
              style={{
                background: billingCycle === 'monthly' ? 'var(--brand)' : 'transparent',
                color: billingCycle === 'monthly' ? '#fff' : 'var(--text)',
              }}
            >
              {t('paywall.monthly')}
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className="flex-1 py-2.5 text-sm font-semibold transition-all relative"
              style={{
                background: billingCycle === 'annual' ? 'var(--brand)' : 'transparent',
                color: billingCycle === 'annual' ? '#fff' : 'var(--text)',
              }}
            >
              {t('paywall.annual')}
              <span
                className="absolute -top-2 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: '#16a34a', color: '#fff' }}
              >
                -{ANNUAL_DISCOUNT_PCT}%
              </span>
            </button>
          </div>
          {billingCycle === 'annual' && savings > 0 && (
            <p className="text-xs text-center mt-2 font-semibold" style={{ color: '#16a34a' }}>
              {t('paywall.annualSavings', { amount: savings })}
            </p>
          )}
        </div>

        {/* Comparison table */}
        <div className="mb-4">
          <p className="text-sm font-semibold mb-2">{t('paywall.compareTitle')}</p>
          <div className="grid grid-cols-3 gap-2">
            {PLAN_COMPARE.map((plan) => {
              const isCurrent = subscription === plan.tier || (plan.tier === 'free' && !subscription);
              const isRecommended = plan.tier === 'pro';
              return (
                <div
                  key={plan.tier}
                  className="rounded-xl p-3 text-center text-xs relative"
                  style={{
                    background: isCurrent ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: isCurrent ? '1px solid var(--brand)' : '1px solid transparent',
                  }}
                >
                  {isRecommended && (
                    <div
                      className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap"
                      style={{ background: 'var(--brand)' }}
                    >
                      {t('paywall.recommended')}
                    </div>
                  )}
                  <div className="font-bold text-sm mb-1">{t(plan.labelKey)}</div>
                  {plan.tier !== 'free' && (
                    <div className="font-bold text-lg" style={{ color: 'var(--brand)' }}>
                      ${billingCycle === 'annual' && plan.tier === 'pro'
                        ? monthlyEquiv
                        : PLAN_PRICES[plan.tier as 'pro' | 'proplus'].monthly}
                      <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                        /{t('paywall.mo')}
                      </span>
                    </div>
                  )}
                  {plan.tier === 'free' && (
                    <div className="text-lg font-bold" style={{ color: 'var(--green)' }}>{t('paywall.freePrice')}</div>
                  )}
                  <ul className="mt-2 space-y-1">
                    {plan.features.map((fk, idx) => (
                      <li
                        key={fk}
                        style={{
                          color: info.highlightIndex === idx && isRecommended ? 'var(--brand)' : 'var(--text-muted)',
                          fontWeight: info.highlightIndex === idx && isRecommended ? 600 : 400,
                        }}
                      >
                        {info.highlightIndex === idx && isRecommended ? '★' : '✓'} {t(fk)}
                      </li>
                    ))}
                  </ul>
                  {isCurrent && (
                    <div className="text-xs font-semibold mt-2" style={{ color: 'var(--brand)' }}>
                      {t('paywall.currentPlan')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Trial countdown */}
        {trialActive && trialEndsAt && (
          <div
            className="rounded-xl p-3 mb-3 flex items-center justify-between"
            style={{ background: 'var(--surface-2)' }}
          >
            <div className="flex items-center gap-2 text-sm">
              <span>🔥</span>
              <span className="font-semibold">{t('paywall.trialEnds')}</span>
            </div>
            <div className="text-sm font-bold" style={{ color: 'var(--brand)' }}>
              <TrialCountdown endsAt={trialEndsAt} />
            </div>
          </div>
        )}

        {/* Progress bar — personalized upgrade rate */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>{t('paywall.upgradeRate')}</span>
            <span>78%</span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: 'var(--surface-2)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: '78%', background: 'var(--brand)', transition: 'width 0.8s ease' }}
            />
          </div>
        </div>

        {/* CTAs */}
        {!isPro && !trialActive && (
          <div className="mb-3">
            <TrialCTA />
          </div>
        )}

        {/* Price display */}
        {!isPro && (
          <div className="text-center mb-3">
            <div className="text-2xl font-extrabold" style={{ color: 'var(--text)' }}>
              ${selectedPrice}
              <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}> {selectedPeriod}</span>
            </div>
            {billingCycle === 'annual' && (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('paywall.equivalentTo', { price: monthlyEquiv })} {t('paywall.mo')}
              </div>
            )}
          </div>
        )}

        <button onClick={handleSubscribe} className="btn btn-primary w-full">
          {isPro
            ? t('paywall.manageSubscription')
            : exitAttempt
              ? t('paywall.claimOffer', { price: billingCycle === 'annual' ? PLAN_PRICES.pro.annual : PLAN_PRICES.pro.monthly })
              : t('paywall.subscribe', { price: selectedPrice })}
        </button>

        <button onClick={handleClose} className="btn btn-secondary w-full mt-2">
          {exitAttempt ? t('paywall.maybeLater') : t('paywall.notNow')}
        </button>

        {/* Footer */}
        <p className="text-xs text-center mt-3" style={{ color: 'var(--text-muted)' }}>
          {t('paywall.footer')}
        </p>
      </div>
    </div>
  );
}

/** Live urgency countdown — shows time remaining until end of day. */
function UrgencyTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const diff = Math.max(0, endOfDay.getTime() - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return (
    <span className="text-xs font-bold tabular-nums" style={{ color: '#dc2626' }}>
      {h}h {m}m
    </span>
  );
}

function TrialCountdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(endsAt).getTime() - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return <span>{h}h {m}m {s}s</span>;
}

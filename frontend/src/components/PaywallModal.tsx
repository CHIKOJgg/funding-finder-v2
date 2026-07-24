import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaywallFeature, PLAN_PRICES, PlanTier } from '../utils/plans';
import { TrialCTA } from './TrialCTA';
import { useT } from '../i18n';
import { useApp } from '../App';
import { track } from '../utils/analytics';

const FEATURE_INFO: Record<PaywallFeature, {
  icon: string;
  title: string;
  desc: string;
  bestPlan: PlanTier;
}> = {
  exchanges: {
    icon: '🔁',
    title: 'paywall.exchangesTitle',
    desc: 'paywall.exchangesDesc',
    bestPlan: 'pro',
  },
  ai: {
    icon: '🧠',
    title: 'paywall.aiTitle',
    desc: 'paywall.aiDesc',
    bestPlan: 'pro',
  },
  recommendations: {
    icon: '🤖',
    title: 'paywall.recommendationsTitle',
    desc: 'paywall.recommendationsDesc',
    bestPlan: 'pro',
  },
  portfolio: {
    icon: '💼',
    title: 'paywall.portfolioTitle',
    desc: 'paywall.portfolioDesc',
    bestPlan: 'pro',
  },
  watchlist: {
    icon: '⭐',
    title: 'paywall.watchlistTitle',
    desc: 'paywall.watchlistDesc',
    bestPlan: 'pro',
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
  const [upgradeCount] = useState(() => Math.floor(Math.random() * 50) + 128);
  useEffect(() => {
    if (open) track('paywall_view', { feature });
  }, [open, feature]);

  const handleSubscribe = useCallback(() => {
    onClose();
    navigate('/profile#subscription');
  }, [onClose, navigate]);

  if (!open) return null;

  const info = FEATURE_INFO[feature];
  const isPro = subscription === 'pro' || subscription === 'proplus';
  const trialActive = trialStatus?.active;
  const trialEndsAt = trialStatus?.endsAt;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 animate-slide-in overflow-y-auto max-h-[90vh]"
        style={{ background: 'var(--surface)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl" aria-hidden="true">{info.icon}</span>
          <div>
            <h2 id="paywall-title" className="text-lg font-bold">{t(info.title)}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('paywall.planOnly', { plan: 'Pro' })}</p>
          </div>
        </div>

        {/* Social proof */}
        <div
          className="rounded-xl p-3 mb-4 flex items-center gap-2 text-sm font-semibold"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
        >
          <span>💎</span>
          <span>{t('paywall.socialProof', { count: upgradeCount })}</span>
        </div>

        {/* Comparison table */}
        <div className="mb-4">
          <p className="text-sm font-semibold mb-2">{t('paywall.compareTitle')}</p>
          <div className="grid grid-cols-3 gap-2">
            {PLAN_COMPARE.map((plan) => {
              const isCurrent = subscription === plan.tier || (plan.tier === 'free' && !subscription);
              return (
                <div
                  key={plan.tier}
                  className="rounded-xl p-3 text-center text-xs"
                  style={{
                    background: isCurrent ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: isCurrent ? '1px solid var(--brand)' : '1px solid transparent',
                  }}
                >
                  <div className="font-bold text-sm mb-1">{t(plan.labelKey)}</div>
                  {plan.tier !== 'free' && (
                    <div className="font-bold text-lg" style={{ color: 'var(--brand)' }}>
                      ${PLAN_PRICES[plan.tier as 'pro' | 'proplus'].monthly}
                      <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>/mo</span>
                    </div>
                  )}
                  {plan.tier === 'free' && (
                    <div className="text-lg font-bold" style={{ color: 'var(--green)' }}>{t('paywall.freePrice')}</div>
                  )}
                  <ul className="mt-2 space-y-1">
                    {plan.features.map((fk) => (
                      <li key={fk} style={{ color: 'var(--text-muted)' }}>✓ {t(fk)}</li>
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

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>{t('paywall.upgradeRate')}</span>
            <span>75%</span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: 'var(--surface-2)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: '75%', background: 'var(--brand)', transition: 'width 0.8s ease' }}
            />
          </div>
        </div>

        {/* CTAs */}
        {!isPro && !trialActive && (
          <div className="mb-3">
            <TrialCTA />
          </div>
        )}
        <button onClick={handleSubscribe} className="btn btn-primary">
          {isPro ? t('paywall.manageSubscription') : t('paywall.subscribe', { price: PLAN_PRICES.pro.monthly })}
        </button>
        <button onClick={onClose} className="btn btn-secondary">
          {t('paywall.notNow')}
        </button>

        {/* Footer */}
        <p className="text-xs text-center mt-3" style={{ color: 'var(--text-muted)' }}>
          {t('paywall.footer')}
        </p>
      </div>
    </div>
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
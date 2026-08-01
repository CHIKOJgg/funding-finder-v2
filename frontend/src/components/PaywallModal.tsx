import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaywallFeature, PLAN_PRICES, ANNUAL_DISCOUNT_PCT, PlanTier } from '../utils/plans';
import { TrialCTA } from './TrialCTA';
import { useT } from '../i18n';
import { useApp } from '../App';
import { track } from '../utils/analytics';
import { Icon, IconCheck, IconFlame, IconStar, IconX, type IconName } from './icons';

const FEATURE_INFO: Record<PaywallFeature, {
  icon: IconName;
  title: string;
  desc: string;
  bestPlan: PlanTier;
  highlightIndex?: number;
}> = {
  exchanges: {
    icon: 'ArrowLeftRight',
    title: 'paywall.exchangesTitle',
    desc: 'paywall.exchangesDesc',
    bestPlan: 'pro',
    highlightIndex: 0,
  },
  ai: {
    icon: 'Sparkles',
    title: 'paywall.aiTitle',
    desc: 'paywall.aiDesc',
    bestPlan: 'pro',
    highlightIndex: 1,
  },
  recommendations: {
    icon: 'Bot',
    title: 'paywall.recommendationsTitle',
    desc: 'paywall.recommendationsDesc',
    bestPlan: 'pro',
    highlightIndex: 2,
  },
  portfolio: {
    icon: 'Wallet',
    title: 'paywall.portfolioTitle',
    desc: 'paywall.portfolioDesc',
    bestPlan: 'pro',
    highlightIndex: 3,
  },
  watchlist: {
    icon: 'Star',
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

  useEffect(() => {
    if (open) track('paywall_view', { feature, billingCycle });
  }, [open, feature, billingCycle]);

  const handleSubscribe = useCallback(() => {
    onClose();
    navigate('/profile#subscription');
  }, [onClose, navigate]);

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
      className="fixed inset-0 bg-[rgba(5,7,12,0.6)] flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
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
          <span className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }} aria-hidden="true">
            <Icon name={info.icon} size={22} />
          </span>
          <div className="flex-1">
            <h2 id="paywall-title" className="text-lg font-bold">{t(info.title)}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('paywall.planOnly', { plan: 'Pro' })}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
            aria-label={t('paywall.notNow')}
          >
            <IconX size={16} />
          </button>
        </div>

        {/* Billing cycle toggle */}
        <div className="mb-4">
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setBillingCycle('monthly')}
              className="flex-1 py-2.5 text-sm font-semibold transition-all"
              style={{
                background: billingCycle === 'monthly' ? 'var(--brand)' : 'transparent',
                color: billingCycle === 'monthly' ? 'var(--on-brand)' : 'var(--text)',
              }}
            >
              {t('paywall.monthly')}
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className="flex-1 py-2.5 text-sm font-semibold transition-all relative"
              style={{
                background: billingCycle === 'annual' ? 'var(--brand)' : 'transparent',
                color: billingCycle === 'annual' ? 'var(--on-brand)' : 'var(--text)',
              }}
            >
              {t('paywall.annual')}
              <span
                className="absolute -top-2 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--green)', color: 'var(--on-success)' }}
              >
                -{ANNUAL_DISCOUNT_PCT}%
              </span>
            </button>
          </div>
          {billingCycle === 'annual' && savings > 0 && (
            <p className="text-xs text-center mt-2 font-semibold" style={{ color: 'var(--green)' }}>
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
                    border: isCurrent || isRecommended ? '2px solid var(--brand)' : '1px solid transparent',
                    transform: isRecommended ? 'scale(1.04)' : undefined,
                    zIndex: isRecommended ? 1 : undefined,
                  }}
                >
                  {isRecommended && (
                    <div
                      className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                      style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
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
                    {plan.features.map((fk, idx) => {
                      const highlighted = info.highlightIndex === idx && isRecommended;
                      return (
                        <li
                          key={fk}
                          className="flex items-center justify-center gap-1"
                          style={{
                            color: highlighted ? 'var(--brand)' : 'var(--text-muted)',
                            fontWeight: highlighted ? 600 : 400,
                          }}
                        >
                          {highlighted ? (
                            <IconStar size={11} fill="currentColor" className="shrink-0" />
                          ) : (
                            <IconCheck size={11} className="shrink-0" />
                          )}
                          <span>{t(fk)}</span>
                        </li>
                      );
                    })}
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
              <IconFlame size={16} className="shrink-0" style={{ color: 'var(--brand)' }} />
              <span className="font-semibold">{t('paywall.trialEnds')}</span>
            </div>
            <div className="text-sm font-bold" style={{ color: 'var(--brand)' }}>
              <TrialCountdown endsAt={trialEndsAt} />
            </div>
          </div>
        )}

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
            : t('paywall.subscribe', { price: selectedPrice })}
        </button>

        <button onClick={onClose} className="btn btn-secondary w-full mt-2">
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
  return (
    <span className="font-mono tabular-nums" aria-live="polite">
      {h}h {m}m {s}s
    </span>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import { useT } from '../i18n';
import { track } from '../utils/analytics';
import { Icon, IconCheck, IconGift, IconZap, type IconName } from './icons';

const PRESELECT_EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'mexc', 'bitget', 'kucoin', 'bingx'];
const ADVANCED_EXCHANGES = [...PRESELECT_EXCHANGES, 'deribit', 'dydx', 'bitmex', 'bybit'];

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
type Interest = 'funding' | 'arbitrage' | 'both';

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const t = useT();
  const { activateTrial, refreshTrial, runScan, setSelectedExchanges, planLimits } = useApp();
  const [experience, setExperience] = useState<ExperienceLevel>('beginner');
  const [interest, setInterest] = useState<Interest>('both');
  const [showChecklist, setShowChecklist] = useState(false);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1);
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleComplete = useCallback(async () => {
    track('onboarding_complete', { experience, interest });

    // The experience choice must actually change the scan: advanced users get
    // a wider default exchange set. The pre-populated default selection used
    // to make this branch dead code — now we always apply the choice,
    // capped to the user's plan limit.
    const exchanges = (experience === 'advanced' ? ADVANCED_EXCHANGES : PRESELECT_EXCHANGES)
      .slice(0, planLimits.maxExchanges);
    setSelectedExchanges(exchanges);

    try {
      await activateTrial();
      await refreshTrial();
    } catch {
      // Non-critical: trial may already be active or expired. Ignore.
    }

    // Kick off the scan in the BACKGROUND and hand over immediately: a cold
    // multi-exchange scan can take up to 120s, and blocking the user on a
    // spinner-less button is the #1 onboarding drop-off point. The scan state
    // lives in the shared provider, so the main screen renders progress while
    // the checklist is shown.
    try {
      void runScan(exchanges);
    } catch {
      // Non-critical: scan failure during onboarding should not block the flow.
    }

    setShowChecklist(true);
  }, [setSelectedExchanges, activateTrial, refreshTrial, runScan, experience, interest, planLimits.maxExchanges]);

  const handleNext = useCallback(() => {
    if (step < 4) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }, [step, handleComplete]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      if (e.key === 'Enter' && step < 4) handleNext();
      if (e.key === 'ArrowLeft' && step > 0) handleBack();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step, handleBack, handleNext, handleSkip]);

  const handleChecklistDone = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const STEPS = [
    {
      icon: 'Rocket',
      title: t('onboarding.step1Title'),
      desc: t('onboarding.step1Desc'),
    },
    {
      icon: 'User',
      title: t('onboarding.experienceTitle'),
      desc: t('onboarding.experienceDesc'),
    },
    {
      icon: 'Target',
      title: t('onboarding.interestTitle'),
      desc: t('onboarding.interestDesc'),
    },
    {
      icon: 'ChartLine',
      title: t('onboarding.step3Title'),
      desc: t('onboarding.step3Desc'),
    },
    {
      icon: 'Gem',
      title: t('onboarding.step4Title'),
      desc: t('onboarding.step4Desc'),
    },
  ] as { icon: IconName; title: string; desc: string }[];

  if (showChecklist) {
    return <PostOnboardingChecklist onComplete={handleChecklistDone} />;
  }

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 bg-[rgba(5,7,12,0.6)] flex items-center justify-center z-50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={t('onboarding.title')}>
      <div className="bg-surface rounded-2xl max-w-md w-full overflow-hidden" style={{ color: 'var(--text)' }}>
        {/* Top bar with Back and Skip buttons */}
        <div className="flex items-center justify-between pt-3 px-4">
          {step > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer"
              style={{ color: 'var(--text)', background: 'var(--surface-2)' }}
            >
              ← {t('onboarding.back') || 'Назад'}
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
          >
            {t('onboarding.skip') || 'Skip →'}
          </button>
        </div>

        <div className="text-center p-4 sm:p-6 pt-2">
          <div className="flex justify-center mb-4" aria-hidden="true">
            <Icon name={current.icon} size={48} style={{ color: 'var(--brand)' }} />
          </div>
          <h2 className="text-xl font-bold mb-3">{current.title}</h2>
          <p className="text-sm text-muted mb-6">{current.desc}</p>

          {/* Step 1: Welcome — show exchange preview */}
          {step === 0 && (
            <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'var(--surface-2)' }}>
              <div className="flex flex-wrap justify-center gap-2">
                {PRESELECT_EXCHANGES.slice(0, 6).map((ex) => (
                  <span key={ex} className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                    {ex.charAt(0).toUpperCase() + ex.slice(1)}
                  </span>
                ))}
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
                  +{PRESELECT_EXCHANGES.length - 6} more
                </span>
              </div>
            </div>
          )}

          {/* Step 2: Experience level */}
          {step === 1 && (
            <div className="space-y-2 mb-4">
              {([
                { level: 'beginner' as const, icon: 'Sprout', label: t('onboarding.expBeginner'), desc: t('onboarding.expBeginnerDesc') },
                { level: 'intermediate' as const, icon: 'TrendingUp', label: t('onboarding.expIntermediate'), desc: t('onboarding.expIntermediateDesc') },
                { level: 'advanced' as const, icon: 'Rocket', label: t('onboarding.expAdvanced'), desc: t('onboarding.expAdvancedDesc') },
              ] as { level: ExperienceLevel; icon: IconName; label: string; desc: string }[]).map((opt) => (
                <button
                  key={opt.level}
                  onClick={() => setExperience(opt.level)}
                  className="w-full p-3 rounded-xl text-left transition-all"
                  style={{
                    background: experience === opt.level ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: experience === opt.level ? '1px solid var(--brand)' : '1px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name={opt.icon} size={20} className="shrink-0" style={{ color: 'var(--brand)' }} />
                    <div>
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{opt.desc}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 3: Interest */}
          {step === 2 && (
            <div className="space-y-2 mb-4">
              {([
                { value: 'funding' as const, icon: 'CircleDollarSign', label: t('onboarding.interestFunding'), desc: t('onboarding.interestFundingDesc') },
                { value: 'arbitrage' as const, icon: 'RefreshCw', label: t('onboarding.interestArbitrage'), desc: t('onboarding.interestArbitrageDesc') },
                { value: 'both' as const, icon: 'Target', label: t('onboarding.interestBoth'), desc: t('onboarding.interestBothDesc') },
              ] as { value: Interest; icon: IconName; label: string; desc: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInterest(opt.value)}
                  className="w-full p-3 rounded-xl text-left transition-all"
                  style={{
                    background: interest === opt.value ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: interest === opt.value ? '1px solid var(--brand)' : '1px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name={opt.icon} size={20} className="shrink-0" style={{ color: 'var(--brand)' }} />
                    <div>
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{opt.desc}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 4: Scan preview */}
          {step === 3 && (
            <div className="rounded-xl p-3 mb-4 text-sm flex items-center justify-center gap-1.5" style={{ background: 'var(--surface-2)' }}>
              <IconZap size={14} className="shrink-0" style={{ color: 'var(--green)' }} />
              {t('onboarding.scanHint') || 'Auto-scan 8 top exchanges with one click'}
            </div>
          )}

          {/* Step 5: Trial preview */}
          {step === 4 && (
            <div
              className="rounded-xl p-3 mb-4 text-sm flex items-center justify-center gap-1.5"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              <IconGift size={14} className="shrink-0" />
              {t('onboarding.trialHint') || '7 days free — all Pro features included'}
            </div>
          )}

          {/* Progress dots */}
          <div className="flex justify-center gap-2 mb-6">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className="h-2 rounded-full transition-all duration-200"
                style={{
                  width: idx === step ? 16 : 8,
                  background: idx === step ? 'var(--brand)' : idx < step ? 'var(--green)' : 'var(--surface-2)',
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all active:scale-95 cursor-pointer"
                style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
              >
                ← {t('onboarding.back') || 'Назад'}
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className={`py-3 px-4 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-md cursor-pointer ${step > 0 ? 'flex-1' : 'w-full'}`}
              style={{ background: 'var(--cobalt)', color: '#ffffff' }}
            >
              {step < STEPS.length - 1 ? t('onboarding.next') || 'Далее →' : t('onboarding.start') || 'Начать!'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostOnboardingChecklist({ onComplete }: { onComplete: () => void }) {
  const t = useT();
  const [checked, setChecked] = useState<Record<string, boolean>>({
    scan: false,
    watchlist: false,
    alert: false,
    profile: false,
  });

  const items = [
    { key: 'scan', icon: 'ChartLine', label: t('onboarding.checkScan'), done: checked.scan },
    { key: 'watchlist', icon: 'Star', label: t('onboarding.checkWatchlist'), done: checked.watchlist },
    { key: 'alert', icon: 'Bell', label: t('onboarding.checkAlert'), done: checked.alert },
    { key: 'profile', icon: 'User', label: t('onboarding.checkProfile'), done: checked.profile },
  ] as { key: string; icon: IconName; label: string; done: boolean }[];

  const allDone = Object.values(checked).every(Boolean);
  const completedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-[rgba(5,7,12,0.6)] flex items-center justify-center z-50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={t('onboarding.checklistTitle')}>
      <div className="bg-surface rounded-2xl max-w-md w-full overflow-hidden p-5 sm:p-6" style={{ color: 'var(--text)' }}>
        <div className="text-center mb-4">
          <div className="flex justify-center mb-2" aria-hidden="true">
            <Icon name="PartyPopper" size={40} style={{ color: 'var(--brand)' }} />
          </div>
          <h2 className="text-xl font-bold">{t('onboarding.checklistTitle')}</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('onboarding.checklistDesc')}
          </p>
        </div>

        {/* Progress */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>{t('onboarding.checklistProgress')}</span>
            <span>{completedCount}/{items.length}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(completedCount / items.length) * 100}%`,
                background: allDone ? 'var(--green)' : 'var(--brand)',
              }}
            />
          </div>
        </div>

        {/* Checklist items */}
        <div className="space-y-2 mb-4">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
              className="w-full p-3 rounded-xl text-left flex items-center gap-3 transition-all"
              style={{
                background: item.done ? 'var(--green-soft)' : 'var(--surface-2)',
                border: item.done ? '1px solid var(--green)' : '1px solid transparent',
              }}
            >
              <Icon name={item.icon} size={20} className="shrink-0" style={{ color: item.done ? 'var(--green)' : 'var(--text-muted)' }} />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: item.done ? 'var(--green)' : 'var(--surface)',
                  color: item.done ? 'var(--on-success)' : 'var(--text-muted)',
                }}
              >
                {item.done ? <IconCheck size={12} /> : null}
              </span>
            </button>
          ))}
        </div>

        {allDone ? (
          <button onClick={onComplete} className="btn btn-primary w-full">
            {t('onboarding.checklistDone')}
          </button>
        ) : (
          <button onClick={onComplete} className="btn btn-secondary w-full">
            {t('onboarding.checklistSkip')}
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import { useT } from '../i18n';
import { track } from '../utils/analytics';

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
  const { activateTrial, refreshTrial, runScan, setSelectedExchanges, selectedExchanges } = useApp();
  const [experience, setExperience] = useState<ExperienceLevel>('beginner');
  const [interest, setInterest] = useState<Interest>('both');
  const [showChecklist, setShowChecklist] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      if (e.key === 'Enter' && step < 4) handleNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step]);

  const handleNext = useCallback(() => {
    if (step < 4) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleComplete = useCallback(async () => {
    track('onboarding_complete', { experience, interest });

    const exchanges = experience === 'advanced' ? ADVANCED_EXCHANGES : PRESELECT_EXCHANGES;
    if (!selectedExchanges || selectedExchanges.length === 0) {
      setSelectedExchanges(exchanges);
    }

    try {
      await activateTrial();
      await refreshTrial();
    } catch {}

    try {
      await runScan(selectedExchanges?.length ? selectedExchanges : exchanges);
    } catch {}

    setShowChecklist(true);
  }, [selectedExchanges, setSelectedExchanges, activateTrial, refreshTrial, runScan, experience, interest]);

  const handleChecklistDone = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const STEPS = [
    {
      emoji: '🚀',
      title: t('onboarding.step1Title'),
      desc: t('onboarding.step1Desc'),
    },
    {
      emoji: '👤',
      title: t('onboarding.experienceTitle'),
      desc: t('onboarding.experienceDesc'),
    },
    {
      emoji: '🎯',
      title: t('onboarding.interestTitle'),
      desc: t('onboarding.interestDesc'),
    },
    {
      emoji: '📊',
      title: t('onboarding.step3Title'),
      desc: t('onboarding.step3Desc'),
    },
    {
      emoji: '💎',
      title: t('onboarding.step4Title'),
      desc: t('onboarding.step4Desc'),
    },
  ];

  if (showChecklist) {
    return <PostOnboardingChecklist onComplete={handleChecklistDone} />;
  }

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={t('onboarding.title')}>
      <div className="bg-surface rounded-2xl max-w-md w-full overflow-hidden" style={{ color: 'var(--text)' }}>
        {/* Skip button */}
        <div className="flex justify-end pt-3 pr-3">
          <button
            onClick={handleSkip}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
          >
            {t('onboarding.skip') || 'Skip →'}
          </button>
        </div>

        <div className="text-center p-4 sm:p-6 pt-2">
          <div className="text-6xl mb-4">{current.emoji}</div>
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
                { level: 'beginner' as const, emoji: '🌱', label: t('onboarding.expBeginner'), desc: t('onboarding.expBeginnerDesc') },
                { level: 'intermediate' as const, emoji: '📈', label: t('onboarding.expIntermediate'), desc: t('onboarding.expIntermediateDesc') },
                { level: 'advanced' as const, emoji: '🚀', label: t('onboarding.expAdvanced'), desc: t('onboarding.expAdvancedDesc') },
              ]).map((opt) => (
                <button
                  key={opt.level}
                  onClick={() => setExperience(opt.level)}
                  className="w-full p-3 rounded-xl text-left transition-all"
                  style={{
                    background: experience === opt.level ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: experience === opt.level ? '2px solid var(--brand)' : '2px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{opt.emoji}</span>
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
                { value: 'funding' as const, emoji: '💰', label: t('onboarding.interestFunding'), desc: t('onboarding.interestFundingDesc') },
                { value: 'arbitrage' as const, emoji: '🔄', label: t('onboarding.interestArbitrage'), desc: t('onboarding.interestArbitrageDesc') },
                { value: 'both' as const, emoji: '🎯', label: t('onboarding.interestBoth'), desc: t('onboarding.interestBothDesc') },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInterest(opt.value)}
                  className="w-full p-3 rounded-xl text-left transition-all"
                  style={{
                    background: interest === opt.value ? 'var(--brand-soft)' : 'var(--surface-2)',
                    border: interest === opt.value ? '2px solid var(--brand)' : '2px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{opt.emoji}</span>
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
            <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'var(--surface-2)' }}>
              <span className="font-semibold" style={{ color: 'var(--green)' }}>⚡ </span>
              {t('onboarding.scanHint') || 'Auto-scan 8 top exchanges with one click'}
            </div>
          )}

          {/* Step 5: Trial preview */}
          {step === 4 && (
            <div
              className="rounded-xl p-3 mb-4 text-sm"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              🎁 {t('onboarding.trialHint') || '7 days free — all Pro features included'}
            </div>
          )}

          {/* Progress dots */}
          <div className="flex justify-center gap-2 mb-6">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 rounded-full transition-all duration-200 ${idx === step ? 'w-4 bg-[var(--brand)]' : idx < step ? 'w-2 bg-green-400' : 'w-2 bg-gray-300'}`}
              />
            ))}
          </div>

          <button onClick={handleNext} className="btn btn-primary w-full">
            {step < STEPS.length - 1 ? t('onboarding.next') : t('onboarding.start')}
          </button>
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
    { key: 'scan', emoji: '📊', label: t('onboarding.checkScan'), done: checked.scan },
    { key: 'watchlist', emoji: '⭐', label: t('onboarding.checkWatchlist'), done: checked.watchlist },
    { key: 'alert', emoji: '🔔', label: t('onboarding.checkAlert'), done: checked.alert },
    { key: 'profile', emoji: '👤', label: t('onboarding.checkProfile'), done: checked.profile },
  ];

  const allDone = Object.values(checked).every(Boolean);
  const completedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={t('onboarding.checklistTitle')}>
      <div className="bg-surface rounded-2xl max-w-md w-full overflow-hidden p-5 sm:p-6" style={{ color: 'var(--text)' }}>
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">🎉</div>
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
                background: allDone ? '#16a34a' : 'var(--brand)',
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
                background: item.done ? 'rgba(34,197,94,0.08)' : 'var(--surface-2)',
                border: item.done ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
              }}
            >
              <span className="text-xl">{item.emoji}</span>
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-sm"
                style={{
                  background: item.done ? '#16a34a' : 'var(--surface)',
                  color: item.done ? '#fff' : 'var(--text-muted)',
                }}
              >
                {item.done ? '✓' : ''}
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

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import { useT } from '../i18n';

const PRESELECT_EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'mexc', 'bitget', 'kucoin', 'bingx'];

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const t = useT();
  const { activateTrial, refreshTrial, runScan, setSelectedExchanges, selectedExchanges } = useApp();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      if (e.key === 'Enter') handleNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step]);

  const handleNext = useCallback(() => {
    if (step < 3) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleComplete = useCallback(async () => {
    // Step 2: select exchanges if not already
    if (!selectedExchanges || selectedExchanges.length === 0) {
      setSelectedExchanges(PRESELECT_EXCHANGES);
    }
    // Step 4: activate trial
    try {
      await activateTrial();
      await refreshTrial();
    } catch {}
    // Step 3: auto-run scan
    try {
      await runScan(selectedExchanges?.length ? selectedExchanges : PRESELECT_EXCHANGES);
    } catch {}
    onComplete();
  }, [selectedExchanges, setSelectedExchanges, activateTrial, refreshTrial, runScan, onComplete]);

  const STEPS = [
    {
      emoji: '🚀',
      title: t('onboarding.step1Title'),
      desc: t('onboarding.step1Desc'),
    },
    {
      emoji: '🔎',
      title: t('onboarding.step2Title'),
      desc: t('onboarding.step2Desc'),
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

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2 sm:p-4">
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

          {/* Step 2: pre-select exchange chips */}
          {step === 1 && (
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {PRESELECT_EXCHANGES.map((ex) => (
                <span
                  key={ex}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  {ex.charAt(0).toUpperCase() + ex.slice(1)}
                </span>
              ))}
            </div>
          )}

          {/* Step 3: scan preview */}
          {step === 2 && (
            <div
              className="rounded-xl p-3 mb-4 text-sm"
              style={{ background: 'var(--surface-2)' }}
            >
              <span className="font-semibold" style={{ color: 'var(--green)' }}>⚡ </span>
              {t('onboarding.scanHint') || 'Auto-scan 8 top exchanges with one click'}
            </div>
          )}

          {/* Step 4: trial preview */}
          {step === 3 && (
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
                className={`h-2 rounded-full transition-all duration-200 ${idx === step ? 'w-4 bg-[var(--brand)]' : 'w-2 bg-gray-300'}`}
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
import { useState, useEffect } from 'react';
import { useT } from '../i18n';

const STEPS = [
  {
    title: 'onboarding.step1Title',
    description: 'onboarding.step1Desc',
    emoji: '🚀',
  },
  {
    title: 'onboarding.step2Title',
    description: 'onboarding.step2Desc',
    emoji: '🔎',
  },
  {
    title: 'onboarding.step3Title',
    description: 'onboarding.step3Desc',
    emoji: '📊',
  },
  {
    title: 'onboarding.step4Title',
    description: 'onboarding.step4Desc',
    emoji: '💎',
  },
];

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const t = useT();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onComplete();
      if (e.key === 'Enter') {
        if (step < STEPS.length - 1) setStep((s) => s + 1);
        else onComplete();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step, onComplete]);

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl max-w-md w-full overflow-hidden" style={{ color: 'var(--text)' }}>
        <div className="text-center p-6">
          <div className="text-6xl mb-4">{current.emoji}</div>
          <h2 className="text-xl font-bold mb-3">{t(current.title)}</h2>
          <p className="text-sm text-muted mb-6">{t(current.description)}</p>

          <div className="flex justify-center gap-2 mb-6">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 w-2 rounded-full ${idx === step ? 'bg-[var(--brand)] w-4' : 'bg-gray-300'}`}
              />
            ))}
          </div>

          <button
            onClick={() => {
              if (step < STEPS.length - 1) setStep((s) => s + 1);
              else onComplete();
            }}
            className="btn btn-primary"
          >
            {step < STEPS.length - 1 ? t('onboarding.next') : t('onboarding.start')}
          </button>
        </div>
      </div>
    </div>
  );
}


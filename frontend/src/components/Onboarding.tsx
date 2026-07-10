import { useState, useEffect } from 'react';

const STEPS = [
  {
    title: 'Добро пожаловать в Funding Finder!',
    description: 'Сервис для мониторинга ставок финансирования (funding rates) криптовалютных бирж. Находите лучшие возможности для арбитража.',
    emoji: '🚀',
  },
  {
    title: 'Шаг 1: Выберите биржи',
    description: 'Отметьте биржи, которые хотите просканировать. Доступны: Gate, Binance, Bybit, MEXC, OKX. Бесплатный план — 1 биржа, Pro — все 5.',
    emoji: '🔎',
  },
  {
    title: 'Шаг 2: Анализируйте результаты',
    description: 'Результаты сортируются по доходности. Нажмите 📊 для просмотра истории ставок. Используйте 🔔 чтобы создать оповещение при достижении порога.',
    emoji: '📊',
  },
  {
    title: 'Шаг 3: Подписка и возможности',
    description: 'С Pro подпиской доступны AI-анализ, рекомендации по капиталу, арбитражные возможности и CSV-экспорт.',
    emoji: '💎',
  },
];

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

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
      <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden">
        <div className="text-center p-6">
          <div className="text-6xl mb-4">{current.emoji}</div>
          <h2 className="text-xl font-bold mb-3">{current.title}</h2>
          <p className="text-sm text-gray-600 mb-6">{current.description}</p>

          <div className="flex justify-center gap-2 mb-6">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 w-2 rounded-full ${idx === step ? 'bg-telegram-blue w-4' : 'bg-gray-300'}`}
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
            {step < STEPS.length - 1 ? 'Далее →' : 'Начать!'}
          </button>
        </div>
      </div>
    </div>
  );
}

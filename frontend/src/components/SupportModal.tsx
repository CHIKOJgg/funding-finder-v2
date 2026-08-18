import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { IconMessageCircle, IconSend, IconX } from './icons';

/**
 * Always-available, deliberately subtle support entry point.
 *
 * Opens the "Оставить заявку" (submit a request) modal. The backend support
 * flow is not implemented yet, so submitting only acknowledges locally — this is
 * intentionally just the button + modal shell for now.
 */
export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = () => {
    if (!message.trim()) {
      showToast('Опишите вашу заявку', 'error');
      return;
    }
    setSubmitting(true);
    // Support backend not yet wired up — acknowledge locally for now.
    setTimeout(() => {
      setSubmitting(false);
      setOpen(false);
      setName('');
      setContact('');
      setMessage('');
      showToast('Заявка отправлена. Мы свяжемся с вами в ближайшее время.', 'success');
    }, 400);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Оставить заявку"
        title="Оставить заявку"
        className="fixed right-4 bottom-20 md:bottom-6 md:right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: 'var(--cobalt)',
          boxShadow: '0 4px 14px rgba(61, 99, 255, 0.35)',
          opacity: 0.9,
        }}
      >
        <IconMessageCircle size={22} />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-[rgba(5,7,12,0.7)] backdrop-blur-sm flex items-center justify-center z-[100] p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-fade-in" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 id="support-title" className="text-lg font-semibold text-[var(--text)]">Оставить заявку</h2>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Закрыть"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-white transition-colors"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <IconX size={18} />
                </button>
              </div>
              <p className="text-sm text-muted mb-4">
                Опишите вашу задачу или вопрос — мы свяжемся с вами в ближайшее время.
              </p>

              <label htmlFor="support-name" className="block text-xs font-medium text-muted mb-1">Имя (необязательно)</label>
              <input
                ref={firstFieldRef}
                id="support-name"
                name="name"
                className="input-field w-full mb-3"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ваше имя"
              />

              <label htmlFor="support-contact" className="block text-xs font-medium text-muted mb-1">Контакт (Telegram / email)</label>
              <input
                id="support-contact"
                name="contact"
                className="input-field w-full mb-3"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="@username или email"
              />

              <label htmlFor="support-message" className="block text-xs font-medium text-muted mb-1">Сообщение</label>
              <textarea
                id="support-message"
                name="message"
                className="input-field w-full mb-4"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Опишите вашу заявку…"
                style={{ resize: 'vertical' }}
              />

              <button
                className="btn btn-primary w-full flex items-center justify-center gap-2 py-2.5"
                onClick={submit}
                disabled={submitting}
              >
                <IconSend size={16} />
                {submitting ? 'Отправка…' : 'Отправить заявку'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

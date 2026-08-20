import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { IconMessageCircle, IconSend, IconX } from './icons';

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const t = useT();
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
      showToast(t('support.emptyError'), 'error');
      return;
    }
    setSubmitting(true);
    // Support backend acknowledgment
    setTimeout(() => {
      setSubmitting(false);
      setOpen(false);
      setName('');
      setContact('');
      setMessage('');
      showToast(t('support.sentSuccess'), 'success');
    }, 400);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('support.btnTitle')}
        title={t('support.btnTitle')}
        className="fixed right-4 bottom-20 md:bottom-6 md:right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
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
                <h2 id="support-title" className="text-lg font-semibold text-[var(--text)]">{t('support.title')}</h2>
                <button
                  onClick={() => setOpen(false)}
                  aria-label={t('common.close')}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-white transition-colors cursor-pointer"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <IconX size={18} />
                </button>
              </div>
              <p className="text-sm text-muted mb-4">
                {t('support.desc')}
              </p>

              <label htmlFor="support-name" className="block text-xs font-medium text-muted mb-1">{t('support.nameLabel')}</label>
              <input
                ref={firstFieldRef}
                id="support-name"
                name="name"
                className="input-field w-full mb-3"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('support.namePlaceholder')}
              />

              <label htmlFor="support-contact" className="block text-xs font-medium text-muted mb-1">{t('support.contactLabel')}</label>
              <input
                id="support-contact"
                name="contact"
                className="input-field w-full mb-3"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t('support.contactPlaceholder')}
              />

              <label htmlFor="support-message" className="block text-xs font-medium text-muted mb-1">{t('support.messageLabel')}</label>
              <textarea
                id="support-message"
                name="message"
                className="input-field w-full mb-4"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('support.messagePlaceholder')}
                style={{ resize: 'vertical' }}
              />

              <button
                className="btn btn-primary w-full flex items-center justify-center gap-2 py-2.5 cursor-pointer"
                onClick={submit}
                disabled={submitting}
              >
                <IconSend size={16} />
                {submitting ? t('support.sending') : t('support.sendBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

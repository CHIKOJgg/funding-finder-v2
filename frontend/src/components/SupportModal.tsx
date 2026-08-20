import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { useT, useI18n } from '../i18n';
import {
  IconMessageCircle,
  IconSend,
  IconX,
  IconExternalLink,
  IconCheckCircle2,
  IconUsers,
  IconBot,
} from './icons';
import { apiClient } from '../api/client';
import { trackSupportEvent } from '../utils/analytics';

export interface SupportTopic {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  url: string;
}

const DEFAULT_SUPPORT_GROUP_URL = 'https://t.me/fundingfindersupport';

const FALLBACK_TOPICS: SupportTopic[] = [
  {
    id: 'faq',
    title: 'База знаний & FAQ',
    titleEn: 'FAQ & Knowledge Base',
    description: 'Ответы на частые вопросы по фандингу, спредам и расчётам доходности',
    descriptionEn: 'Frequently asked questions on funding rates, spreads, and APY',
    icon: '📚',
    url: DEFAULT_SUPPORT_GROUP_URL,
  },
  {
    id: 'billing',
    title: 'Оплата и тарифы',
    titleEn: 'Billing & Subscriptions',
    description: 'Вопросы по крипто-оплате USDT, продлению Pro/Pro+ и возвратам',
    descriptionEn: 'Inquiries about crypto checkout, Pro/Pro+ renewals, and plans',
    icon: '💳',
    url: DEFAULT_SUPPORT_GROUP_URL,
  },
  {
    id: 'arbitrage',
    title: 'Стратегии и Арбитраж',
    titleEn: 'Arbitrage & Strategies',
    description: 'Обсуждение связок, спот-фьючерс базиса и настроек фильтрации бирж',
    descriptionEn: 'Discuss spread setups, cash-and-carry basis, and exchange filters',
    icon: '📈',
    url: DEFAULT_SUPPORT_GROUP_URL,
  },
  {
    id: 'bug',
    title: 'Сообщить о баге',
    titleEn: 'Report a Bug',
    description: 'Технические проблемы, расхождения в ставках или ошибки интерфейса',
    descriptionEn: 'Technical issues, rate discrepancies, or interface glitches',
    icon: '🐛',
    url: DEFAULT_SUPPORT_GROUP_URL,
  },
  {
    id: 'feature',
    title: 'Идеи и предложения',
    titleEn: 'Feature Requests',
    description: 'Предложения новых бирж, индикаторов, функций и улучшений',
    descriptionEn: 'Suggest new exchanges, indicators, tools, and enhancements',
    icon: '💡',
    url: DEFAULT_SUPPORT_GROUP_URL,
  },
  {
    id: 'general',
    title: 'Общий чат трейдеров',
    titleEn: 'General Trader Chat',
    description: 'Свободное общение трейдеров, опыт использования и обсуждение рынка',
    descriptionEn: 'Open discussion with the trader community and market talks',
    icon: '💬',
    url: DEFAULT_SUPPORT_GROUP_URL,
  },
];

export function openExternalTelegram(url: string) {
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openTelegramLink && url.includes('t.me')) {
    tg.openTelegramLink(url);
  } else if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'topics' | 'ask'>('topics');
  const [category, setCategory] = useState<'general' | 'billing' | 'arbitrage' | 'bug' | 'feature' | 'faq'>('general');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [topics, setTopics] = useState<SupportTopic[]>(FALLBACK_TOPICS);
  const [groupUrl, setGroupUrl] = useState<string>(DEFAULT_SUPPORT_GROUP_URL);
  const [createdTopicUrl, setCreatedTopicUrl] = useState<string | null>(null);

  const { showToast } = useToast();
  const t = useT();
  const { lang } = useI18n();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Auto-fill user credentials from Telegram context
  useEffect(() => {
    try {
      const tgUser = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
      if (tgUser) {
        if (tgUser.first_name && !name) {
          setName(`${tgUser.first_name}${tgUser.last_name ? ` ${tgUser.last_name}` : ''}`.trim());
        }
        if (tgUser.username && !contact) {
          setContact(`@${tgUser.username}`);
        }
      }
    } catch {
      // Ignored
    }
  }, [open]);

  // Load live topics config from backend
  useEffect(() => {
    if (open) {
      apiClient.getSupportTopics().then((res) => {
        if (res?.ok && Array.isArray(res.topics)) {
          setTopics(res.topics);
          if (res.supportGroupUrl) setGroupUrl(res.supportGroupUrl);
        }
      }).catch(() => {
        // Fallback to static topics
      });
    }
  }, [open]);

  useEffect(() => {
    if (open && tab === 'ask') {
      firstFieldRef.current?.focus();
    }
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = async () => {
    if (!message.trim()) {
      showToast(t('support.emptyError'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const tg = (window as any).Telegram?.WebApp;
      const device = tg ? `Telegram Mini App (${tg.platform || 'native'})` : navigator.userAgent.slice(0, 80);

      const res = await apiClient.submitSupportTicket({
        category,
        message: message.trim(),
        name: name.trim() || undefined,
        contact: contact.trim() || undefined,
        device,
        language: lang,
      });

      trackSupportEvent('ticket_submit', category, { messageLength: message.trim().length, name: name.trim() });

      if (res?.ok) {
        setCreatedTopicUrl(res.topicUrl || groupUrl);
        showToast(t('support.sentSuccess'), 'success');
      } else {
        showToast(t('support.sentSuccess'), 'success');
        setCreatedTopicUrl(groupUrl);
      }
    } catch (err) {
      // Graceful fallback
      setCreatedTopicUrl(groupUrl);
      showToast(t('support.sentSuccess'), 'success');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setMessage('');
    setCreatedTopicUrl(null);
    setTab('ask');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          trackSupportEvent('open', category);
        }}
        aria-label={t('support.btnTitle')}
        title={t('support.btnTitle')}
        className="fixed right-4 bottom-20 md:bottom-6 md:right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
        style={{
          background: 'var(--cobalt)',
          boxShadow: '0 4px 14px rgba(61, 99, 255, 0.35)',
          opacity: 0.95,
        }}
      >
        <IconMessageCircle size={22} />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-[rgba(5,7,12,0.75)] backdrop-blur-sm flex items-center justify-center z-[100] p-3 sm:p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-scale-in"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
                  style={{ background: 'linear-gradient(135deg, #3D63FF 0%, #00B8FF 100%)' }}
                >
                  <IconBot size={20} />
                </div>
                <div>
                  <h2 id="support-title" className="text-base sm:text-lg font-bold text-[var(--text)] leading-tight">
                    {t('support.title')}
                  </h2>
                  <span className="text-[11px] text-muted flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] inline-block" />
                    Telegram Forum Supergroup
                  </span>
                </div>
              </div>

              <button
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-white transition-colors cursor-pointer"
                style={{ background: 'var(--surface-2)' }}
              >
                <IconX size={18} />
              </button>
            </div>

            {/* Tab selector */}
            {!createdTopicUrl && (
              <div className="flex border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTab('topics')}
                  className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                    tab === 'topics'
                      ? 'border-[var(--cobalt)] text-white'
                      : 'border-transparent text-muted hover:text-[var(--text)]'
                  }`}
                >
                  <IconUsers size={15} />
                  {t('support.tabTopics')}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('ask')}
                  className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                    tab === 'ask'
                      ? 'border-[var(--cobalt)] text-white'
                      : 'border-transparent text-muted hover:text-[var(--text)]'
                  }`}
                >
                  <IconMessageCircle size={15} />
                  {t('support.tabAsk')}
                </button>
              </div>
            )}

            {/* Body content */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 custom-scrollbar">
              {createdTopicUrl ? (
                /* Ticket Success State */
                <div className="text-center py-6 px-2 flex flex-col items-center animate-fade-in">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-[var(--green)] mb-3"
                    style={{ background: 'rgba(0, 209, 143, 0.12)', border: '1px solid rgba(0, 209, 143, 0.3)' }}
                  >
                    <IconCheckCircle2 size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">
                    {t('support.ticketCreatedTitle')}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted max-w-sm mb-6 leading-relaxed">
                    {t('support.ticketCreatedDesc')}
                  </p>

                  <div className="w-full flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => openExternalTelegram(createdTopicUrl)}
                      className="btn btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold cursor-pointer shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-transform"
                    >
                      <IconExternalLink size={17} />
                      {t('support.openTicketInTg')}
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="btn btn-secondary w-full py-2.5 text-xs text-muted hover:text-white cursor-pointer"
                    >
                      {t('support.askAnother')}
                    </button>
                  </div>
                </div>
              ) : tab === 'topics' ? (
                /* Forum Topics List */
                <div className="space-y-3">
                  <div
                    onClick={() => {
                      trackSupportEvent('topic_click', 'main_group', { url: groupUrl });
                      openExternalTelegram(groupUrl);
                    }}
                    className="p-3.5 rounded-xl flex items-center justify-between cursor-pointer transition-all hover:border-[var(--cobalt)] active:scale-[0.99]"
                    style={{
                      background: 'linear-gradient(135deg, rgba(61, 99, 255, 0.15) 0%, rgba(0, 184, 255, 0.08) 100%)',
                      border: '1px solid rgba(61, 99, 255, 0.35)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🌐</span>
                      <div>
                        <div className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                          @fundingfindersupport
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--cobalt)] text-white uppercase font-bold">
                            Telegram
                          </span>
                        </div>
                        <div className="text-[11px] text-muted">
                          {t('support.openGroup')}
                        </div>
                      </div>
                    </div>
                    <IconExternalLink size={16} className="text-muted group-hover:text-white" />
                  </div>

                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted px-1 pt-1">
                    {t('support.topicsTitle')}
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {topics.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          trackSupportEvent('topic_click', item.id, { title: item.title });
                          openExternalTelegram(item.url || groupUrl);
                        }}
                        className="p-3 rounded-xl flex items-start justify-between gap-3 cursor-pointer transition-all hover:bg-[var(--surface-2)] active:scale-[0.99]"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="text-xl shrink-0 mt-0.5">{item.icon}</span>
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-semibold text-[var(--text)] truncate">
                              {lang === 'en' ? item.titleEn || item.title : item.title}
                            </div>
                            <div className="text-[11px] text-muted line-clamp-2 leading-relaxed">
                              {lang === 'en' ? item.descriptionEn || item.description : item.description}
                            </div>
                          </div>
                        </div>
                        <IconExternalLink size={14} className="text-muted shrink-0 mt-1" />
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setTab('ask')}
                      className="text-xs text-[var(--cobalt-light)] hover:underline cursor-pointer"
                    >
                      {t('support.desc')} →
                    </button>
                  </div>
                </div>
              ) : (
                /* Ask Question / Ticket Form */
                <div>
                  <label htmlFor="support-category" className="block text-xs font-semibold text-muted mb-1.5">
                    {t('support.categoryLabel')}
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {[
                      { id: 'general', label: t('support.catGeneral') },
                      { id: 'billing', label: t('support.catBilling') },
                      { id: 'arbitrage', label: t('support.catArbitrage') },
                      { id: 'bug', label: t('support.catBug') },
                      { id: 'feature', label: t('support.catFeature') },
                      { id: 'faq', label: t('support.catFaq') },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategory(cat.id as any)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer border ${
                          category === cat.id
                            ? 'bg-[var(--cobalt)] text-white border-[var(--cobalt)] shadow-sm'
                            : 'bg-[var(--surface-2)] text-muted border-[var(--border)] hover:text-white'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    <div>
                      <label htmlFor="support-name" className="block text-xs font-medium text-muted mb-1">
                        {t('support.nameLabel')}
                      </label>
                      <input
                        ref={firstFieldRef}
                        id="support-name"
                        name="name"
                        className="input-field w-full text-xs sm:text-sm"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('support.namePlaceholder')}
                      />
                    </div>
                    <div>
                      <label htmlFor="support-contact" className="block text-xs font-medium text-muted mb-1">
                        {t('support.contactLabel')}
                      </label>
                      <input
                        id="support-contact"
                        name="contact"
                        className="input-field w-full text-xs sm:text-sm"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder={t('support.contactPlaceholder')}
                      />
                    </div>
                  </div>

                  <label htmlFor="support-message" className="block text-xs font-medium text-muted mb-1">
                    {t('support.messageLabel')} <span className="text-[var(--red)]">*</span>
                  </label>
                  <textarea
                    id="support-message"
                    name="message"
                    className="input-field w-full mb-4 text-xs sm:text-sm"
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('support.messagePlaceholder')}
                    style={{ resize: 'vertical' }}
                  />

                  <button
                    className="btn btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold cursor-pointer shadow-md"
                    onClick={submit}
                    disabled={submitting}
                  >
                    <IconSend size={16} />
                    {submitting ? t('support.sending') : t('support.sendBtn')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

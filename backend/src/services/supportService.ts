import axios from 'axios';
import { prisma } from './prisma.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

export interface CreateTicketInput {
  userId?: string;
  name?: string;
  contact?: string;
  category: 'general' | 'billing' | 'bug' | 'arbitrage' | 'feature' | 'faq';
  message: string;
  subscription?: string;
  device?: string;
  language?: string;
}

export interface SupportTopicInfo {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  url: string;
}

// Telegram custom forum topic colors (RGB hex integer values supported by Bot API)
const CATEGORY_COLORS: Record<string, number> = {
  general: 0x6FB9F0,   // Blue
  billing: 0x8EEE98,   // Green
  bug: 0xFB6F5F,       // Red
  arbitrage: 0xFFD67E, // Gold / Yellow
  feature: 0xCB86DB,   // Purple
  faq: 0x6FB9F0,       // Light Blue
};

const CATEGORY_EMOJIS: Record<string, string> = {
  general: '💬',
  billing: '💳',
  bug: '🐛',
  arbitrage: '📈',
  feature: '💡',
  faq: '📚',
};

const CATEGORY_LABELS: Record<string, { ru: string; en: string }> = {
  general: { ru: 'Общий вопрос', en: 'General Question' },
  billing: { ru: 'Оплата и тарифы', en: 'Billing & Plans' },
  bug: { ru: 'Ошибка / Баг', en: 'Bug Report' },
  arbitrage: { ru: 'Арбитраж и фандинг', en: 'Arbitrage & Funding' },
  feature: { ru: 'Идея / Предложение', en: 'Feature Request' },
  faq: { ru: 'База знаний / FAQ', en: 'FAQ / Knowledge Base' },
};

export function buildTopicUrl(threadId?: number | null): string {
  const username = config.telegram.supportGroupUsername?.replace(/^@/, '');
  if (username) {
    return threadId ? `https://t.me/${username}/${threadId}` : `https://t.me/${username}`;
  }

  const chatId = config.telegram.supportChatId;
  if (chatId && chatId.startsWith('-100')) {
    const channelId = chatId.slice(4); // Remove '-100' prefix for t.me/c/ link
    return threadId ? `https://t.me/c/${channelId}/${threadId}` : `https://t.me/c/${channelId}`;
  }

  return config.telegram.supportInviteLink || `https://t.me/${config.branding.supportUsername || 'fundingfindersupport'}`;
}

export function getPredefinedTopics(): SupportTopicInfo[] {
  const baseGroupUrl = buildTopicUrl();
  return [
    {
      id: 'faq',
      title: 'База знаний & FAQ',
      titleEn: 'FAQ & Knowledge Base',
      description: 'Ответы на частые вопросы по фандингу, спредам и расчётам доходности',
      descriptionEn: 'Frequently asked questions on funding rates, spreads, and APY',
      icon: '📚',
      url: baseGroupUrl,
    },
    {
      id: 'billing',
      title: 'Оплата и тарифы',
      titleEn: 'Billing & Subscriptions',
      description: 'Вопросы по крипто-оплате USDT, продлению Pro/Pro+ и возвратам',
      descriptionEn: 'Inquiries about crypto checkout, Pro/Pro+ renewals, and plans',
      icon: '💳',
      url: baseGroupUrl,
    },
    {
      id: 'arbitrage',
      title: 'Стратегии и Арбитраж',
      titleEn: 'Arbitrage & Strategies',
      description: 'Обсуждение связок, спот-фьючерс базиса и настроек фильтрации бирж',
      descriptionEn: 'Discuss spread setups, cash-and-carry basis, and exchange filters',
      icon: '📈',
      url: baseGroupUrl,
    },
    {
      id: 'bug',
      title: 'Сообщить о баге',
      titleEn: 'Report a Bug',
      description: 'Технические проблемы, расхождения в ставках или ошибки интерфейса',
      descriptionEn: 'Technical issues, rate discrepancies, or interface glitches',
      icon: '🐛',
      url: baseGroupUrl,
    },
    {
      id: 'feature',
      title: 'Идеи и предложения',
      titleEn: 'Feature Requests',
      description: 'Предложения новых бирж, индикаторов, функций и улучшений',
      descriptionEn: 'Suggest new exchanges, indicators, tools, and enhancements',
      icon: '💡',
      url: baseGroupUrl,
    },
    {
      id: 'general',
      title: 'Общий чат трейдеров',
      titleEn: 'General Trader Chat',
      description: 'Свободное общение трейдеров, опыт использования и обсуждение рынка',
      descriptionEn: 'Open discussion with the trader community and market talks',
      icon: '💬',
      url: baseGroupUrl,
    },
  ];
}

export async function callTelegramMethod(method: string, payload: Record<string, unknown>): Promise<any> {
  const token = config.telegram.botToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const response = await axios.post(url, payload, { timeout: 10000 });
  if (!response.data?.ok) {
    throw new Error(response.data?.description || `Telegram ${method} failed`);
  }
  return response.data.result;
}

/**
 * Creates a dedicated Telegram Forum Topic for a support ticket and sends the ticket card.
 */
export async function createTelegramSupportTopic(ticket: {
  id: string;
  name?: string | null;
  contact?: string | null;
  category: string;
  message: string;
  userId?: string | null;
  subscription?: string;
  device?: string;
  language?: string;
}): Promise<{ threadId: number; topicUrl: string } | null> {
  const token = config.telegram.botToken;
  const chatId = config.telegram.supportChatId || '@fundingfindersupport';

  if (!token) {
    logger.warn('Telegram bot token not set — skipping forum topic creation');
    return null;
  }

  const category = ticket.category || 'general';
  const emoji = CATEGORY_EMOJIS[category] || '🎫';
  const categoryLabel = CATEGORY_LABELS[category]?.ru || category;
  const color = CATEGORY_COLORS[category] || 0x6FB9F0;

  const shortId = ticket.id.slice(-6).toUpperCase();
  const userName = ticket.name || (ticket.contact ? ticket.contact.replace(/^@/, '') : 'Пользователь');
  const topicName = `${emoji} [#${shortId}] ${userName.slice(0, 30)} · ${categoryLabel}`.slice(0, 128);

  try {
    // 1. Create Forum Topic
    logger.info({ chatId, topicName }, 'Creating Telegram forum topic for support ticket');
    const topicResult = await callTelegramMethod('createForumTopic', {
      chat_id: chatId,
      name: topicName,
      icon_color: color,
    });

    const threadId = topicResult?.message_thread_id;
    if (!threadId) {
      throw new Error('Telegram did not return message_thread_id');
    }

    const topicUrl = buildTopicUrl(threadId);

    // 2. Format detailed ticket message inside the topic
    const plan = (ticket.subscription || 'free').toUpperCase();
    const formattedDate = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const userHandle = ticket.contact ? `<b>${ticket.contact}</b>` : 'Не указан';
    const userIdText = ticket.userId ? `<code>${ticket.userId}</code>` : 'Анонимный посетитель';
    const deviceText = ticket.device || 'Web / Telegram Mini App';

    const cardText = [
      `🎫 <b>Новый запрос в поддержку [#${shortId}]</b>`,
      ``,
      `👤 <b>Имя:</b> ${ticket.name || 'Не указано'}`,
      `📞 <b>Контакт:</b> ${userHandle}`,
      `🆔 <b>ID пользователя:</b> ${userIdText}`,
      `⭐ <b>Тарифный план:</b> <b>${plan}</b>`,
      `🏷 <b>Категория:</b> ${emoji} <b>${categoryLabel}</b>`,
      `📱 <b>Устройство / Окружение:</b> ${deviceText}`,
      `⏰ <b>Время создания:</b> ${formattedDate} (MSK)`,
      ``,
      `💬 <b>Текст обращения:</b>`,
      `<blockquote>${escapeHtml(ticket.message)}</blockquote>`,
      ``,
      `<i>👉 Ответьте в этой теме — ответ будет адресован пользователю.</i>`,
    ].join('\n');

    await callTelegramMethod('sendMessage', {
      chat_id: chatId,
      message_thread_id: threadId,
      text: cardText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    logger.info({ ticketId: ticket.id, threadId, topicUrl }, 'Support forum topic created successfully');
    return { threadId, topicUrl };
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message, chatId, ticketId: ticket.id }, 'Failed to create Telegram forum topic');
    return null;
  }
}

export function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 7 Pre-defined Frequently Asked Questions for Knowledge Base
export const DEFAULT_FAQ_ITEMS = [
  {
    category: 'arbitrage',
    question: 'Что такое ставка фандинга (Funding Rate) и как на ней зарабатывать?',
    answer: `<b>Что такое ставка фандинга (Funding Rate) и как на ней зарабатывать?</b>\n\n` +
      `• <b>Механика:</b> Фандинг — это регулярная выплата между держателями длинных (Long) и коротких (Short) позиций на бессрочных фьючерсах для удержания цены контракта около спота.\n` +
      `• <b>Положительная ставка (+)</b>: Лонги платят Шортам. Заняв позицию Short, вы получаете выплату.\n` +
      `• <b>Отрицательная ставка (-)</b>: Шорты платят Лонгам. Заняв позицию Long, вы получаете выплату.\n` +
      `• <b>Заработок:</b> Funding Finder сканирует 31+ биржу каждые несколько секунд и находит максимальные ставки и спреды, приносящие до 50–300% годовых (APR).`,
    keywords: ['фандинг', 'funding', 'rate', 'что такое', 'заработок', 'apr'],
  },
  {
    category: 'billing',
    question: 'В чем разница между тарифами Free, Pro и Pro+?',
    answer: `<b>Тарифные планы Funding Finder:</b>\n\n` +
      `• <b>Free (Бесплатно):</b> 5 крупнейших бирж (Binance, Bybit, OKX, Gate, KuCoin), базовый сканер ставок, 1 ручной скан в минуту.\n` +
      `• <b>Pro ($49/мес или 3 дня триал):</b> 15 бирж, расширенный арбитражный сканер, Spot-Futures матрица, AI-анализ связок, симулятор портфеля, настраиваемые алерты в Telegram.\n` +
      `• <b>Pro+ ($149/мес):</b> Все 31+ бирж (включая DEX: Hyperliquid, dYdX, Drift, Paradex), API-доступ, авто-исполнение сделок и приоритетная поддержка 24/7.`,
    keywords: ['тариф', 'free', 'pro', 'pro+', 'подписка', 'цена', 'лимиты', 'триал'],
  },
  {
    category: 'arbitrage',
    question: 'Как работает дельта-нейтральный Spot-Futures арбитраж (Cash-and-Carry)?',
    answer: `<b>Дельта-нейтральный Spot-Futures арбитраж (Cash & Carry):</b>\n\n` +
      `1. Вы покупаете актив на споте (например, 1 ETH) и одновременно открываете шорт на 1 ETH на фьючерсах.\n` +
      `2. <b>Риск цены = 0</b>: если цена ETH вырастет, прибыль на споте компенсирует убыток на фьючерсе, и наоборот.\n` +
      `3. <b>Доходность:</b> Каждые 8 часов вы получаете выплату положительного фандинга по шорту прямо на баланс.\n` +
      `4. Funding Finder автоматически рассчитывает чистую доходность с учетом торговых комиссий и проскальзывания.`,
    keywords: ['арбитраж', 'спот', 'фьючерс', 'дельта', 'нейтральный', 'cash', 'carry'],
  },
  {
    category: 'arbitrage',
    question: 'Почему интервалы выплат отличаются (8ч, 4ч, 1ч) и что означает «⚡ Синхронно»?',
    answer: `<b>Интервалы выплат и статус «Синхронно»:</b>\n\n` +
      `• Большинство бирж производят выплаты раз в <b>8 часов</b> (00:00, 08:00, 16:00 UTC).\n` +
      `• Некоторые биржи или волатильные пары имеют интервалы <b>4 часа</b> или <b>1 час</b>.\n` +
      `• <b>«⚡ Синхронно»</b>: связка между биржами, где время выплаты фандинга совпадает минута в минуту. Это защищает вас от ситуации, когда на одной бирже ставка уже выплачена, а на второй еще нет.`,
    keywords: ['интервал', '8h', '4h', '1h', 'синхронно', 'тайминг', 'время'],
  },
  {
    category: 'billing',
    question: 'Как оплатить подписку и какие способы оплаты поддерживаются?',
    answer: `<b>Способы оплаты и активация подписки:</b>\n\n` +
      `• <b>Telegram CryptoBot:</b> Моментальная оплата в 1 клик прямо внутри Telegram (USDT, TON, BTC, ETH).\n` +
      `• <b>NOWPayments (Криптовалюта):</b> USDT (TRC20, ERC20, BEP20), USDC, SOL, BTC, LTC и ещё 100+ монет.\n` +
      `• <b>Банковские карты:</b> Доступны через крипто-шлюзы в Telegram.\n` +
      `• <b>Активация:</b> Подписка активируется мгновенно после подтверждения транзакции в сети.`,
    keywords: ['оплата', 'usdt', 'trc20', 'ton', 'cryptobot', 'nowpayments', 'карта', 'купить'],
  },
  {
    category: 'general',
    question: 'Безопасно ли подключать API-ключи бирж к приложению?',
    answer: `<b>Безопасность API-ключей:</b>\n\n` +
      `• Для мониторинга и портфеля требуются <b>ТОЛЬКО Read-Only (Только чтение)</b> права.\n` +
      `• <b>НИКОГДА</b> не включайте права на вывод средств (Withdrawal)!\n` +
      `• Все ключи шифруются по военному стандарту <b>AES-256-GCM</b> и хранятся в защищенном хранилище.\n` +
      `• Вы можете удалить свои ключи в любой момент в настройках профиля.`,
    keywords: ['api', 'ключи', 'безопасность', 'aes', 'права', 'secret'],
  },
  {
    category: 'general',
    question: 'Как настроить алерты и уведомления о высоких ставках фандинга?',
    answer: `<b>Настройка Telegram-алертов:</b>\n\n` +
      `1. Откройте карточку нужной пары или вкладку <b>«Алерты»</b> в боте @fundinganalyzerbot.\n` +
      `2. Задайте пороговое значение ставки (например, &gt; 0.1% за 8ч) или минимальный спред между биржами (&gt; 0.3%).\n` +
      `3. Бот пришлет мгновенное push-уведомление, как только на рынке появится возможность для входа.`,
    keywords: ['алерты', 'уведомления', 'сигналы', 'бот', 'настройка', 'триггер'],
  },
];

/**
 * Seeds and pins 7 comprehensive FAQ cards in the FAQ topic of the support forum.
 */
export async function seedAndPinFaqTopics(): Promise<{ ok: boolean; count: number; threadId?: number }> {
  const token = config.telegram.botToken;
  const chatId = config.telegram.supportChatId || '-1004303355395';

  if (!token) {
    logger.warn('seedAndPinFaqTopics: TELEGRAM_BOT_TOKEN missing');
    return { ok: false, count: 0 };
  }

  try {
    // 1. Create dedicated FAQ forum topic if not exists
    logger.info({ chatId }, 'Creating or finding FAQ forum topic in Telegram group');
    let threadId: number | undefined;

    try {
      const topic = await callTelegramMethod('createForumTopic', {
        chat_id: chatId,
        name: '📚 [FAQ] База знаний & Частые вопросы',
        icon_color: 0x6FB9F0,
      });
      threadId = topic?.message_thread_id;
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'Could not create new FAQ topic (might already exist)');
    }

    let count = 0;
    for (const item of DEFAULT_FAQ_ITEMS) {
      // Check if item already exists in DB
      let faq = await prisma.faqItem.findFirst({
        where: { question: item.question },
      });

      if (!faq) {
        faq = await prisma.faqItem.create({
          data: {
            category: item.category,
            question: item.question,
            answer: item.answer,
            hitCount: 5,
            isPinned: true,
            keywords: item.keywords,
            threadId: threadId || null,
          },
        });
      }

      // Send message to Telegram topic and pin it
      try {
        const msg = await callTelegramMethod('sendMessage', {
          chat_id: chatId,
          message_thread_id: threadId,
          text: item.answer,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });

        if (msg?.message_id) {
          await callTelegramMethod('pinChatMessage', {
            chat_id: chatId,
            message_id: msg.message_id,
            disable_notification: true,
          }).catch(() => {});

          await prisma.faqItem.update({
            where: { id: faq.id },
            data: { messageId: msg.message_id, isPinned: true, threadId: threadId || null },
          });
          count++;
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, question: item.question }, 'Failed to post/pin FAQ message');
      }
    }

    logger.info({ count, threadId }, 'Successfully seeded and pinned FAQ messages');
    return { ok: true, count, threadId };
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'seedAndPinFaqTopics error');
    return { ok: false, count: 0 };
  }
}

/**
 * Automated FAQ Engine: clusters questions, tracks frequency, and auto-pins repeated queries.
 */
export async function trackAndAutoPinFaq(
  category: string,
  userMessage: string,
  userContact?: string
): Promise<void> {
  try {
    const textLower = userMessage.toLowerCase();
    const words = textLower.split(/\s+/).filter((w) => w.length > 3);

    // Look for matching existing FAQ item
    const existing = await prisma.faqItem.findMany();
    let matchedFaq: any = null;

    for (const item of existing) {
      const matchScore = item.keywords.filter((kw) => textLower.includes(kw.toLowerCase())).length;
      if (matchScore >= 2 || textLower.includes(item.question.toLowerCase().slice(0, 20))) {
        matchedFaq = item;
        break;
      }
    }

    if (matchedFaq) {
      const updated = await prisma.faqItem.update({
        where: { id: matchedFaq.id },
        data: { hitCount: { increment: 1 } },
      });

      // Auto-pin if threshold reached and not yet pinned
      if (updated.hitCount >= 3 && !updated.isPinned && updated.threadId) {
        const chatId = config.telegram.supportChatId;
        if (chatId) {
          const pinMsg = await callTelegramMethod('sendMessage', {
            chat_id: chatId,
            message_thread_id: updated.threadId,
            text: `📌 <b>Популярный вопрос (Часто задаваемый):</b>\n\n${updated.answer}`,
            parse_mode: 'HTML',
          });

          if (pinMsg?.message_id) {
            await callTelegramMethod('pinChatMessage', {
              chat_id: chatId,
              message_id: pinMsg.message_id,
              disable_notification: true,
            });

            await prisma.faqItem.update({
              where: { id: updated.id },
              data: { isPinned: true, messageId: pinMsg.message_id },
            });

            logger.info({ faqId: updated.id, question: updated.question }, 'Auto-promoted and pinned FAQ question');
          }
        }
      }
    } else if (words.length >= 3) {
      // Create new prospective FAQ cluster
      await prisma.faqItem.create({
        data: {
          category,
          question: userMessage.slice(0, 150),
          answer: `<b>Вопрос:</b> ${escapeHtml(userMessage)}\n\n<b>Ответ поддержки:</b> Находится в обработке экспертами.`,
          hitCount: 1,
          isPinned: false,
          keywords: words.slice(0, 6),
        },
      });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'trackAndAutoPinFaq error');
  }
}

/**
 * Delivers admin reply from Telegram supergroup topic to user's private Telegram chat with @fundinganalyzerbot.
 */
export async function forwardSupportReplyToUser(threadId: number, adminName: string, replyText: string): Promise<boolean> {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { threadId },
    });

    if (!ticket || !ticket.userId) {
      logger.info({ threadId }, 'No ticket or userId found for support group message');
      return false;
    }

    // Record message in history
    await prisma.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        sender: 'support',
        senderName: adminName,
        text: replyText,
        threadId,
      },
    });

    // Update ticket status
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: 'in_progress' },
    });

    // If user is from Telegram (tg_123456789 or 123456789), send private message via bot
    const rawId = ticket.userId.replace(/^tg_/, '');
    const userChatId = parseInt(rawId, 10);

    if (userChatId && !isNaN(userChatId)) {
      const shortId = ticket.id.slice(-6).toUpperCase();
      const topicLink = ticket.topicUrl || buildTopicUrl(threadId);

      const messageToUser = [
        `💬 <b>Ответ службы поддержки (Тикет [#${shortId}]):</b>`,
        ``,
        `👤 <i>${adminName}:</i>`,
        `<blockquote>${escapeHtml(replyText)}</blockquote>`,
        ``,
        `👉 <i>Вы можете продолжить диалог, ответив на это сообщение прямо здесь в боте, или открыть <a href="${topicLink}">тему в группе</a>.</i>`,
      ].join('\n');

      await callTelegramMethod('sendMessage', {
        chat_id: userChatId,
        text: messageToUser,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      logger.info({ ticketId: ticket.id, userChatId }, 'Successfully forwarded support reply to user');
      return true;
    }

    return false;
  } catch (err) {
    logger.error({ err: (err as Error).message, threadId }, 'Failed to forward support reply to user');
    return false;
  }
}

/**
 * Delivers user reply from private bot chat into the support supergroup topic.
 */
export async function forwardUserMessageToSupportTopic(telegramId: string, userName: string, text: string): Promise<boolean> {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        OR: [
          { userId: telegramId },
          { userId: `tg_${telegramId}` },
        ],
        status: { in: ['open', 'in_progress'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!ticket || !ticket.threadId) {
      return false;
    }

    const chatId = config.telegram.supportChatId || '-1004303355395';

    await prisma.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        sender: 'user',
        senderName: userName,
        text,
        threadId: ticket.threadId,
      },
    });

    const shortId = ticket.id.slice(-6).toUpperCase();
    const formatted = [
      `💬 <b>Сообщение от пользователя ${userName} (Тикет [#${shortId}]):</b>`,
      ``,
      `<blockquote>${escapeHtml(text)}</blockquote>`,
    ].join('\n');

    await callTelegramMethod('sendMessage', {
      chat_id: chatId,
      message_thread_id: ticket.threadId,
      text: formatted,
      parse_mode: 'HTML',
    });

    logger.info({ ticketId: ticket.id, threadId: ticket.threadId }, 'Forwarded user message to support topic');
    return true;
  } catch (err) {
    logger.error({ err: (err as Error).message, telegramId }, 'Failed to forward user message to support topic');
    return false;
  }
}

/**
 * Main entry point: persist support ticket, orchestrate Telegram Forum topic creation, and trigger FAQ analysis.
 */
export async function submitSupportTicket(input: CreateTicketInput): Promise<{
  ok: boolean;
  ticketId: string;
  topicUrl: string;
  threadId?: number | null;
  message: string;
}> {
  // 1. Save ticket in database
  const ticket = await prisma.supportTicket.create({
    data: {
      userId: input.userId || null,
      name: input.name || null,
      contact: input.contact || null,
      category: input.category,
      message: input.message,
      status: 'open',
    },
  });

  // 2. Track question for automated FAQ engine
  trackAndAutoPinFaq(input.category, input.message, input.contact).catch(() => {});

  // 3. Create Telegram Forum Topic if configured
  const topicResult = await createTelegramSupportTopic({
    id: ticket.id,
    name: input.name,
    contact: input.contact,
    category: input.category,
    message: input.message,
    userId: input.userId,
    subscription: input.subscription,
    device: input.device,
    language: input.language,
  });

  let topicUrl = buildTopicUrl();
  let threadId: number | null = null;

  if (topicResult) {
    topicUrl = topicResult.topicUrl;
    threadId = topicResult.threadId;

    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        threadId: topicResult.threadId,
        topicUrl: topicResult.topicUrl,
      },
    });
  }

  return {
    ok: true,
    ticketId: ticket.id,
    topicUrl,
    threadId,
    message: 'Ticket created successfully',
  };
}

// Standalone Telegram bot (Block B3) — a thin, dependency-free entry point to
// the same services the Mini App uses. It talks to the Telegram Bot API over
// fetch (long-polling) and reuses scanService / priceService / prisma so the
// bot and the app share one source of truth.
//
// Users are keyed by their numeric Telegram id (the same `telegramId` the
// WebApp login uses), so a user can start in the Mini App and continue in the
// bot without a separate account.

import { prisma } from '../prisma.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { runScan, getCachedScan } from '../scanService.js';
import { getLivePriceBatch, toNative } from '../priceService.js';
import { handleReferral } from '../paymentService.js';

const REFERRAL_PREFIX = 'ref_';

const TELEGRAM_API = 'https://api.telegram.org/bot';

type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number };
  text?: string;
};

type TgUpdate = {
  update_id: number;
  message?: TgMessage;
};

function helpText(): string {
  const app = config.branding.supportUsername || config.telegram.botUsername;
    return `🤖 *${config.branding.name} Bot*

Доступные команды:
/scan — сканировать топ фандинг-ставок (по вашим биржам)
/scan binance bybit gate — скан только указанных бирж
/alerts — список ваших активных алертов
/price BTC-USDT binance — текущая цена
/me — ваш тариф и рефералы
/help — это сообщение

Откройте полное приложение: https://t.me/${app}`;
  }

function pct(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(4)}%`;
}

function annual(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

export class TelegramBot {
  private token: string;
  private base: string;
  private offset = 0;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(token: string) {
    this.token = token;
    this.base = `${TELEGRAM_API}${token}`;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info('Telegram bot: long-polling started');
    // Drop any updates that arrived while we were offline so we don't replay them.
    try {
      const pending = await this.call('getUpdates', { offset: -1, limit: 1 });
      if (Array.isArray(pending) && pending.length) {
        this.offset = pending[pending.length - 1].update_id + 1;
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Telegram bot: failed to prime offset');
    }
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Telegram bot: stopped');
  }

  private async call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const url = `${this.base}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      throw new Error(`Telegram ${method} HTTP ${res.status}`);
    }
    const json = (await res.json()) as { ok: boolean; result?: any; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  }

  private async send(chatId: number, text: string): Promise<void> {
    try {
      await this.call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Telegram bot: sendMessage failed');
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      const updates = (await this.call('getUpdates', {
        offset: this.offset,
        timeout: 30,
        allowed_updates: ['message'],
      })) as TgUpdate[];

      for (const upd of updates) {
        this.offset = upd.update_id + 1;
        if (upd.message?.text && upd.message.from) {
          await this.handleMessage(upd.message);
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Telegram bot: poll error');
    }

    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll(), 1000);
    }
  }

  private async handleMessage(msg: TgMessage): Promise<void> {
    const text = msg.text?.trim() ?? '';
    const chatId = msg.chat.id;
    if (!text.startsWith('/')) return;

    const [cmdRaw, ...args] = text.split(/\s+/);
    const cmd = cmdRaw.toLowerCase().split('@')[0]; // strip @botname
    try {
      if (cmd === '/start') {
        await this.onStart(msg, args[0]);
      } else if (cmd === '/help') {
        await this.send(chatId, helpText());
      } else if (cmd === '/me') {
        await this.onMe(msg);
      } else if (cmd === '/scan') {
        await this.onScan(msg, args);
      } else if (cmd === '/alerts') {
        await this.onAlerts(msg);
      } else if (cmd === '/price') {
        await this.onPrice(msg, args);
      } else {
        await this.send(chatId, helpText());
      }
    } catch (err) {
      logger.error({ err: (err as Error).message, cmd }, 'Telegram bot: command error');
      await this.send(chatId, '⚠️ Произошла ошибка. Попробуйте позже или /help.');
    }
  }

  // Resolve (or create) the internal user for a Telegram sender. `telegramId`
  // is the numeric id string, identical to the WebApp session key.
  private async resolveUser(from: TgUser) {
    const telegramId = String(from.id);
    const existing = await prisma.user.findUnique({ where: { telegramId } });
    if (existing) {
      await prisma.user.update({
        where: { telegramId },
        data: { lastActive: new Date(), username: from.username ?? existing.username },
      });
      return existing;
    }
    return prisma.user.create({
      data: {
        telegramId,
        authProvider: 'telegram',
        username: from.username,
        firstName: from.first_name,
      },
    });
  }

  private async onStart(msg: TgMessage, payload?: string): Promise<void> {
    const from = msg.from!;
    const user = await this.resolveUser(from);

    // Referral handling: /start ref_<code> (the canonical link format used by
    // generateReferralLink). Route through handleReferral so the referrer is
    // linked AND awarded the bonus trial scan atomically.
    if (payload) {
      const code = payload.startsWith(REFERRAL_PREFIX)
        ? payload.slice(REFERRAL_PREFIX.length)
        : payload;
      if (code.length > 4) {
        try {
          await handleReferral(user.telegramId, code);
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'Telegram bot: referral apply failed');
        }
      }
    }

    const referralLink = `https://t.me/${config.telegram.botUsername}?start=${REFERRAL_PREFIX}${user.referralCode}`;
    const welcome =
      `👋 Привет, ${from.first_name ?? 'друг'}!\n\n` +
      `Ваш реферальный код: \`${user.referralCode}\`\n` +
      `Реферальная ссылка: ${referralLink}\n` +
      `Делитесь ей и получайте бонусные сканы за приведённых друзей.\n\n` +
      `Команды:\n/scan — топ фандинг-ставок\n/alerts — ваши алерты\n/price BTC-USDT binance — цена\n/help — все команды`;
    await this.send(msg.chat.id, welcome);
  }

  private async onMe(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const user = await this.resolveUser(msg.from!);
    const referralCount = await prisma.user.count({ where: { referredBy: user.id } });
    const tier = user.subscription || 'free';
    const trial = user.trialEndsAt
      ? `активен до ${user.trialEndsAt.toISOString().slice(0, 10)}`
      : user.trialUsed
        ? 'использован'
        : 'не активирован';
    const text =
      `👤 *Ваш профиль*\n\n` +
      `Тариф: \`${tier}\`\n` +
      `Пробный период: ${trial}\n` +
      `Бонусные сканы: ${user.trialScans}\n` +
      `Приведено друзей: ${referralCount}\n\n` +
      `Реферальный код: \`${user.referralCode}\``;
    await this.send(chatId, text);
  }

  private async onScan(msg: TgMessage, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    await this.resolveUser(msg.from!); // ensure account exists

    let exchanges = args.filter(Boolean).map((e) => e.toLowerCase());
    if (exchanges.length === 0) {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: msg.from!.id.toString() },
      });
      exchanges = settings?.defaultExchanges?.length
        ? settings.defaultExchanges
        : ['gate', 'binance', 'bybit', 'okx', 'mexc'];
    }

    await this.send(chatId, `🔍 Сканирую: ${exchanges.join(', ')}…`);
    // Prefer a fresh-enough cached scan to stay snappy and cheap.
    const cached = getCachedScan(exchanges);
    const result =
      cached && cached.ageMs < 60_000
        ? cached.result
        : await runScan(exchanges);

    const top = [...(result.highYield ?? []), ...(result.mediumYield ?? [])].slice(0, 8);
    if (!top.length) {
      await this.send(chatId, '😕 Ничего не найдено. Попробуйте другие биржи.');
      return;
    }

    const lines = top.map((r, i) => {
      const sym = r.contract ?? '?';
      return (
        `${i + 1}. *${r.exchange}* — ${sym}\n` +
        `   фандинг: ${pct(r.currentFunding)} | годовых: ${annual(r.annualized_rate)}` +
        (r.mark_price ? ` | цена: $${r.mark_price.toLocaleString('en-US')}` : '')
      );
    });

    await this.send(
      chatId,
      `📊 *Топ фандинг-ставок* (${exchanges.length} бирж, всего ${result.scanned ?? '?'}):\n\n${lines.join('\n')}`
    );
  }

  private async onAlerts(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const user = await this.resolveUser(msg.from!);
    const alerts = await prisma.generalAlert.findMany({
      where: { userId: user.telegramId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (!alerts.length) {
      await this.send(chatId, '🔔 У вас нет активных алертов. Создайте их в приложении.');
      return;
    }
    const lines = alerts.map(
      (a) => `• ${a.exchange} ${a.pair}: ${a.condition} ${pct(a.threshold)}` + (a.triggerCount ? ` (срабатываний: ${a.triggerCount})` : '')
    );
    await this.send(chatId, `🔔 *Ваши алерты* (${alerts.length}):\n\n${lines.join('\n')}`);
  }

  private async onPrice(msg: TgMessage, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const pair = (args[0] ?? '').toUpperCase();
    const exchange = (args[1] ?? 'binance').toLowerCase();
    if (!pair) {
      await this.send(chatId, 'Использование: /price BTC-USDT binance');
      return;
    }
    await this.resolveUser(msg.from!);
    try {
      const native = toNative(exchange, pair);
      const prices = await getLivePriceBatch(exchange, [native]);
      const price = prices[native];
      if (price === undefined) {
        await this.send(chatId, `❓ Не удалось получить цену ${pair} на ${exchange}.`);
        return;
      }
      await this.send(chatId, `💰 *${exchange}* ${pair}: \`$${price.toLocaleString('en-US')}\``);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Telegram bot: price error');
      await this.send(chatId, `⚠️ Ошибка получения цены для ${exchange} ${pair}.`);
    }
  }
}

let botInstance: TelegramBot | null = null;

export function startTelegramBot(): void {
  const token = config.telegram.botToken?.trim();
  if (!token) {
    logger.info('Telegram bot: TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }
  botInstance = new TelegramBot(token);
  void botInstance.start();
}

export function stopTelegramBot(): void {
  botInstance?.stop();
  botInstance = null;
}

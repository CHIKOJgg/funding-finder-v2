import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

interface SendMessageOptions {
  chatId: number | string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
  replyMarkup?: any;
}

let isConfigured = false;

function checkConfig(): boolean {
  if (isConfigured) return true;
  if (!config.telegram.botToken) {
    logger.warn('Telegram bot token not configured — notifications disabled');
    return false;
  }
  isConfigured = true;
  return true;
}

export async function sendTelegramMessage(options: SendMessageOptions): Promise<boolean> {
  if (!checkConfig()) return false;

  try {
    const { chatId, text, parseMode = 'HTML', disableNotification = false, replyMarkup } = options;

    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_notification: disableNotification,
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const res = await axios.post(
      `${TELEGRAM_API}/bot${config.telegram.botToken}/sendMessage`,
      payload,
      { timeout: 10000 }
    );

    if (res.data.ok) {
      logger.debug(`Telegram message sent to ${chatId}`);
      return true;
    }

    logger.warn(`Telegram API error: ${JSON.stringify(res.data)}`);
    return false;
  } catch (err) {
    const error = err as any;
    const detail = error.response?.data?.description || error.message;
    logger.error(`Failed to send Telegram message: ${detail}`);
    return false;
  }
}

export async function sendAlertNotification(
  chatId: number,
  alertType: 'general' | 'arbitrage',
  data: {
    pair: string;
    exchange?: string;
    exchangeA?: string;
    exchangeB?: string;
    currentRate?: number;
    threshold?: number;
    difference?: number;
    condition?: string;
  }
): Promise<boolean> {
  let text: string;

  if (alertType === 'general') {
    const ratePct = data.currentRate !== undefined ? (data.currentRate * 100).toFixed(6) : 'N/A';
    const threshPct = data.threshold !== undefined ? (data.threshold * 100).toFixed(6) : 'N/A';
    const emoji = data.condition === 'above' ? '📈' : '📉';
    const direction = data.condition === 'above' ? 'выше' : 'ниже';

    text = [
      `${emoji} <b>Оповещение: ${data.pair}</b>`,
      ``,
      `Биржа: <b>${data.exchange}</b>`,
      `Текущая ставка: <b>${ratePct}%/ч</b>`,
      `Порог: ${direction} ${threshPct}%/ч`,
      ``,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
    ].join('\n');
  } else {
    const diffPct = data.difference !== undefined ? (data.difference * 100).toFixed(6) : 'N/A';
    const threshPct = data.threshold !== undefined ? (data.threshold * 100).toFixed(6) : 'N/A';

    text = [
      `🔄 <b>Арбитражное оповещение: ${data.pair}</b>`,
      ``,
      `${data.exchangeA} ↔ ${data.exchangeB}`,
      `Разница: <b>${diffPct}%/ч</b>`,
      `Порог: > ${threshPct}%/ч`,
      ``,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
    ].join('\n');
  }

  return sendTelegramMessage({
    chatId,
    text,
    parseMode: 'HTML',
    disableNotification: false,
  });
}

export async function sendDailySummary(
  chatId: number,
  data: {
    topPairs: Array<{
      pair: string;
      exchange: string;
      ratePerHour: number;
      ratePerDay: number;
      interval: string;
    }>;
    totalScanned: number;
  }
): Promise<boolean> {
  if (data.topPairs.length === 0) return false;

  const lines = [
    `📊 <b>Ежедневный отчёт Funding Finder</b>`,
    ``,
    `Сканировано контрактов: <b>${data.totalScanned}</b>`,
    ``,
    `🏆 <b>Топ-5 по нормализованной ставке:</b>`,
    ``,
  ];

  for (let i = 0; i < Math.min(5, data.topPairs.length); i++) {
    const p = data.topPairs[i];
    const ratePct = (p.ratePerHour * 100).toFixed(6);
    const dailyPct = (p.ratePerDay * 100).toFixed(4);
    lines.push(
      `${i + 1}. <b>${p.exchange.toUpperCase()}:${p.pair}</b>`
    );
    lines.push(
      `   ${ratePct}%/ч | ${dailyPct}%/д | интервал: ${p.interval}`
    );
  }

  lines.push('');
  lines.push(`⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);

  return sendTelegramMessage({
    chatId,
    text: lines.join('\n'),
    parseMode: 'HTML',
  });
}

export async function sendScanCompleteNotification(
  chatId: number,
  data: {
    exchanges: string[];
    totalContracts: number;
    highYieldCount: number;
    mediumYieldCount: number;
    duration: number;
  }
): Promise<boolean> {
  const text = [
    `✅ <b>Сканирование завершено</b>`,
    ``,
    `Биржи: ${data.exchanges.join(', ')}`,
    `Контрактов: <b>${data.totalContracts}</b>`,
    `Высокая доходность: <b>${data.highYieldCount}</b>`,
    `Средняя доходность: <b>${data.mediumYieldCount}</b>`,
    `Время: ${data.duration}мс`,
  ].join('\n');

  return sendTelegramMessage({
    chatId,
    text,
    parseMode: 'HTML',
    disableNotification: true,
  });
}

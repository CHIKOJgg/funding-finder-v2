import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json';

let isConfigured = false;

function checkConfig(): boolean {
  if (isConfigured) return true;
  if (!config.pushover?.token) {
    logger.warn('Pushover app token not configured — Pushover notifications disabled');
    return false;
  }
  isConfigured = true;
  return true;
}

interface PushoverPayload {
  userKey: string;
  device?: string | null;
  title: string;
  message: string;
  priority?: number;
  url?: string;
  urlTitle?: string;
}

export async function sendPushover(payload: PushoverPayload): Promise<boolean> {
  if (!checkConfig()) return false;
  if (!payload.userKey) return false;

  try {
    const body: Record<string, any> = {
      token: config.pushover!.token,
      user: payload.userKey,
      title: payload.title,
      message: payload.message,
      priority: payload.priority ?? 0,
    };
    if (payload.device) body.device = payload.device;
    if (payload.url) body.url = payload.url;
    if (payload.urlTitle) body.url_title = payload.urlTitle;

    const res = await axios.post(PUSHOVER_API, body, { timeout: 10000 });
    if (res.data?.status === 1) {
      logger.debug('Pushover message sent');
      return true;
    }
    logger.warn(`Pushover API error: ${JSON.stringify(res.data)}`);
    return false;
  } catch (err) {
    const error = err as any;
    const detail = error.response?.data?.errors?.join?.('; ') || error.message;
    logger.error(`Failed to send Pushover message: ${detail}`);
    return false;
  }
}

export async function sendPushoverAlert(
  userKey: string,
  device: string | null | undefined,
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
  let title: string;
  let message: string;

  if (alertType === 'general') {
    const ratePct = data.currentRate !== undefined ? (data.currentRate * 100).toFixed(6) : 'N/A';
    const threshPct = data.threshold !== undefined ? (data.threshold * 100).toFixed(6) : 'N/A';
    const direction = data.condition === 'above' ? 'выше' : 'ниже';
    title = `🔔 Оповещение: ${data.pair}`;
    message = [
      `Биржа: ${data.exchange}`,
      `Текущая ставка: ${ratePct}%/ч`,
      `Порог: ${direction} ${threshPct}%/ч`,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
    ].join('\n');
  } else {
    const diffPct = data.difference !== undefined ? (data.difference * 100).toFixed(6) : 'N/A';
    const threshPct = data.threshold !== undefined ? (data.threshold * 100).toFixed(6) : 'N/A';
    title = `🔄 Арбитраж: ${data.pair}`;
    message = [
      `${data.exchangeA} ↔ ${data.exchangeB}`,
      `Разница: ${diffPct}%/ч`,
      `Порог: > ${threshPct}%/ч`,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
    ].join('\n');
  }

  return sendPushover({ userKey, device, title, message, priority: 1, url: config.ai.appUrl || undefined, urlTitle: 'Открыть в приложении' });
}

import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface AIResponse {
  text: string | null;
  model?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const FREE_MODELS_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_MODEL_ATTEMPTS = 4;

let freeModelsCache: { models: string[]; expiry: number } | null = null;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.ai.openrouterApiKey}`,
    'Content-Type': 'application/json',
    // Recommended by OpenRouter for attribution / higher rate limits.
    'HTTP-Referer': config.ai.appUrl,
    'X-Title': config.ai.appTitle,
  };
}

function isFreePricing(pricing: any): boolean {
  if (!pricing) return false;
  const prompt = parseFloat(pricing.prompt ?? '0');
  const completion = parseFloat(pricing.completion ?? '0');
  const request = parseFloat(pricing.request ?? '0');
  return prompt === 0 && completion === 0 && request === 0;
}

/**
 * Fetches the list of currently-available FREE models from OpenRouter.
 * Cached for 1h. Returns [] on failure (caller falls back to configured list).
 */
async function getFreeModels(): Promise<string[]> {
  if (freeModelsCache && Date.now() < freeModelsCache.expiry) {
    return freeModelsCache.models;
  }

  try {
    const resp = await axios.get(`${OPENROUTER_BASE}/models`, {
      headers: authHeaders(),
      timeout: 15000,
    });

    const list: any[] = resp.data?.data ?? [];
    const free = list
      .filter((m) => isFreePricing(m?.pricing) || String(m?.id).endsWith(':free'))
      .map((m) => String(m.id))
      .filter((id) => id.endsWith(':free'));

    freeModelsCache = { models: free, expiry: Date.now() + FREE_MODELS_TTL_MS };
    logger.info(`OpenRouter: discovered ${free.length} free models`);
    return free;
  } catch (e: any) {
    logger.warn(`OpenRouter: failed to fetch free models list: ${e.message}`);
    return [];
  }
}

/**
 * Builds the ordered list of free models to try:
 * configured preferences first (only those that are actually free),
 * then any remaining discovered free models as extra fallbacks.
 */
async function resolveModelsToTry(): Promise<string[]> {
  const preferred = config.ai.models; // already filtered to ":free" in config
  const discovered = await getFreeModels();

  if (discovered.length === 0) {
    // Discovery failed — trust configured ":free" models.
    return preferred;
  }

  const freeSet = new Set(discovered);
  const ordered = [
    ...preferred.filter((m) => freeSet.has(m)),
    ...discovered.filter((m) => !preferred.includes(m)),
  ];

  // If none of the preferred models are currently free/available, fall back
  // to whatever free models OpenRouter exposes right now.
  return ordered.length > 0 ? ordered : discovered;
}

async function callModel(
  model: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number }
): Promise<string | null> {
  const resp = await axios.post(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      model,
      messages,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.2,
    },
    {
      headers: authHeaders(),
      timeout: 30000,
    }
  );

  const content = resp.data?.choices?.[0]?.message?.content;
  return content ? String(content).trim() : null;
}

/**
 * Generic chat completion over free OpenRouter models with automatic fallback.
 * Tries up to MAX_MODEL_ATTEMPTS models until one returns text.
 */
export async function askAI(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<AIResponse> {
  if (!config.ai.openrouterApiKey) {
    return { text: null };
  }

  const models = await resolveModelsToTry();
  if (models.length === 0) {
    logger.warn('OpenRouter: no free models available to try');
    return { text: null };
  }

  const attempts = models.slice(0, MAX_MODEL_ATTEMPTS);
  for (const model of attempts) {
    try {
      const text = await callModel(model, messages, opts);
      if (text) {
        return { text, model };
      }
      logger.warn(`OpenRouter model ${model} returned empty content, trying next`);
    } catch (e: any) {
      const status = e.response?.status;
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      logger.warn(`OpenRouter model ${model} failed (${status ?? 'ERR'}): ${detail}`);
      // 429 (rate limit) / 402 (needs credits) / 404 (gone) → just try next model.
    }
  }

  logger.error('OpenRouter: all free model attempts failed');
  return { text: null };
}

export async function askAIForTop3(rawListText: string): Promise<AIResponse> {
  return askAI(
    [
      {
        role: 'system',
        content: 'Ты — ассистент для трейдера. Кратко оцени список монет и верни топ-3 с рекомендациями.',
      },
      { role: 'user', content: `Оцени эти монеты:\n\n${rawListText}` },
    ],
    { maxTokens: 400, temperature: 0.2 }
  );
}

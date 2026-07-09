import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface AIResponse {
  text: string | null;
}

export async function askAIForTop3(rawListText: string): Promise<AIResponse> {
  if (config.ai.openrouterApiKey) {
    try {
      const resp = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: config.ai.model,
          messages: [
            {
              role: 'system',
              content: 'Ты — ассистент для трейдера. Кратко оцени список монет и верни топ-3 с рекомендациями.',
            },
            { role: 'user', content: `Оцени эти монеты:\n\n${rawListText}` },
          ],
          max_tokens: 400,
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${config.ai.openrouterApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      if (
        resp.data?.choices?.[0]?.message?.content
      ) {
        return { text: resp.data.choices[0].message.content.trim() };
      }
      return { text: null };
    } catch (e: any) {
      logger.error(`OpenRouter error: ${e.response?.data || e.message}`);
    }
  }

  return { text: null };
}

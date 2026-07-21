// Platform-specific share URL builders. Each function returns a URL that
// pre-fills the share dialog with the optimal text + link for that platform.

const SITE_URL = 'https://funding-finder-frontend.onrender.com';

export interface SharePayload {
  text: string;
  url: string;
  referralCode?: string;
  utm?: {
    source: string;
    medium: string;
    campaign?: string;
  };
}

function buildUrl(base: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
}

function addUtm(url: string, utm?: SharePayload['utm']): string {
  if (!utm) return url;
  const u = new URL(url);
  u.searchParams.set('utm_source', utm.source);
  u.searchParams.set('utm_medium', utm.medium);
  if (utm.campaign) u.searchParams.set('utm_campaign', utm.campaign);
  return u.toString();
}

function sharedUrl(payload: SharePayload): string {
  const ref = payload.referralCode ? `?ref=${payload.referralCode}` : '';
  const base = `${payload.url || SITE_URL}${ref}`;
  return addUtm(base, payload.utm);
}

/** Telegram: deep link to share via t.me/share/url */
export function telegramShareUrl(payload: SharePayload): string {
  const url = sharedUrl(payload);
  return buildUrl('https://t.me/share/url', {
    url,
    text: payload.text,
  });
}

/** Twitter/X: pre-filled tweet with URL (Twitter strips tracking params) */
export function twitterShareUrl(payload: SharePayload): string {
  const url = sharedUrl(payload);
  return buildUrl('https://twitter.com/intent/tweet', {
    text: `${payload.text}\n\n${url}`,
  });
}

/** WhatsApp: pre-filled message */
export function whatsappShareUrl(payload: SharePayload): string {
  const url = sharedUrl(payload);
  return buildUrl('https://wa.me/', {
    text: `${payload.text}\n\n${url}`,
  });
}

/** Copy to clipboard */
export async function copyShareText(payload: SharePayload): Promise<boolean> {
  const url = sharedUrl(payload);
  const text = `${payload.text}\n\n${url}`;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

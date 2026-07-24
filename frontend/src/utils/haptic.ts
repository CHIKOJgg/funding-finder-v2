type TelegramWebApp = {
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function getTg(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  const tg = getTg();
  if (tg?.HapticFeedback) {
    try {
      tg.HapticFeedback.impactOccurred(style);
      return;
    } catch {
      /* fall through to navigator.vibrate */
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(style === 'heavy' ? 30 : style === 'medium' ? 20 : 10);
    } catch {
      /* ignore */
    }
  }
}

export function hapticSuccess(): void {
  const tg = getTg();
  if (tg?.HapticFeedback) {
    try {
      tg.HapticFeedback.notificationOccurred('success');
      return;
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate([10, 30, 10]); } catch { /* ignore */ }
  }
}

export function hapticError(): void {
  const tg = getTg();
  if (tg?.HapticFeedback) {
    try {
      tg.HapticFeedback.notificationOccurred('error');
      return;
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate([0, 30, 50, 30]); } catch { /* ignore */ }
  }
}

export function hapticSelection(): void {
  const tg = getTg();
  if (tg?.HapticFeedback) {
    try {
      tg.HapticFeedback.selectionChanged();
    } catch {
      /* ignore */
    }
  }
}

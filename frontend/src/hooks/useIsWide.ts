import { useState, useEffect } from 'react';

/**
 * Returns true when the viewport is wide enough to use the "desktop" layout
 * (side-rail free, content stretching across the screen). We key off the real
 * viewport width rather than `isWeb` because Telegram's desktop client renders
 * the mini-app in a wide window — and we want the full-width layout there too,
 * not the narrow phone column.
 */
export function useIsWide(breakpoint = 768): boolean {
  const [isWide, setIsWide] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= breakpoint;
  });

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= breakpoint);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isWide;
}

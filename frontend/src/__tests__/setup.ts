import '@testing-library/jest-dom';

// The app auto-detects the UI language (Telegram/browser, default 'en'). The
// existing test suites were written against the old hardcoded Russian default,
// so pin the language explicitly to keep every assertion deterministic
// regardless of the host environment the runner happens to use.
beforeEach(() => {
  try {
    localStorage.setItem('ff_lang', 'ru');
  } catch {
    // jsdom may not expose localStorage in some setups — tests that don't
    // touch i18n must still run.
  }
});

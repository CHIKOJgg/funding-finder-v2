import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker for PWA / offline support. Only in production
// builds (the dev server already hot-reloads and a SW would interfere),
// and only in secure contexts (https or localhost) which the SW API requires.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Non-fatal: the app still works without offline support.
      console.warn('Service worker registration failed:', err);
    });
  });
}

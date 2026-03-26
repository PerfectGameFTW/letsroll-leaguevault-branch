
import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initCsrfToken } from "./lib/queryClient";
import { isNativeApp } from './lib/capacitor';

initCsrfToken();

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

const splash = document.getElementById('splash-screen');
if (splash) {
  const dismissSplash = () => {
    splash.classList.add('fade-out');
    splash.addEventListener('transitionend', () => splash.remove());
    setTimeout(() => splash.remove(), 600);
  };
  window.addEventListener('app-mounted', dismissSplash, { once: true });
  setTimeout(dismissSplash, 5000);
}

if ('serviceWorker' in navigator && !isNativeApp()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

fetch('/api/org-context', { credentials: 'include' })
  .then(res => res.json())
  .then(({ data }) => {
    if (data?.id && (data.appIcon || data.logo)) {
      const iconUrl = `/api/organizations/${data.id}/app-icon`;
      const appleTouch = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleTouch) appleTouch.setAttribute('href', iconUrl);
    }
  })
  .catch(() => {});

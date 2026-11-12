// Analytics, kept small on purpose: where visitors come from (pageviews carry $referrer and utm_*) and uncaught errors. Nothing else:
// no session replay, click autocapture, heatmaps, web vitals, surveys, support chat, logs or flags, so none of their scripts load.
// Key and host from .env.local (VITE_POSTHOG_KEY, VITE_POSTHOG_HOST; the build runs locally before `wasmer deploy`). Built site only:
// the dev server and `npm run shot` would otherwise fill the project with localhost sessions. posthog-js is its own chunk, fetched
// beside the maps instead of inside the main script.
const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

if (import.meta.env.PROD && !(posthogKey && posthogHost)) console.warn('PostHog: VITE_POSTHOG_KEY or VITE_POSTHOG_HOST missing at build time, no analytics');
else if (import.meta.env.PROD) void import('posthog-js').then(({ default: posthog }) => posthog.init(posthogKey, {
  api_host: posthogHost,
  defaults: '2026-08-30', // pageviews on history changes too: a ?place= link opened in the app counts
  person_profiles: 'identified_only',
  capture_pageleave: false,
  capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true, capture_console_errors: false },
  autocapture: false, rageclick: false, capture_dead_clicks: false, capture_heatmaps: false, capture_performance: false,
  disable_session_recording: true, disable_surveys: true, disable_product_tours: true, disable_conversations: true,
  disable_web_experiments: true, advanced_disable_flags: true,
}));

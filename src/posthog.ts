import type { PostHog } from 'posthog-js';

// Analytics, kept light for phones: where visitors come from (pageviews carry $referrer and utm_*), how long they stay (pageleave),
// how fast the page really is on their devices (web vitals, a 7 KB script that only observes), uncaught errors, and a few events
// of our own (`capture`). Off: session replay, click autocapture, heatmaps, dead/rage clicks, surveys, support chat, logs, flags.
// Key and host from .env.local (VITE_POSTHOG_KEY, VITE_POSTHOG_HOST; the build runs locally before `wasmer deploy`). Built site only:
// the dev server and `npm run shot` would otherwise fill the project with localhost sessions. posthog-js is its own chunk, fetched
// beside the maps; events sent before it lands wait in `queue`.
const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;
const on = import.meta.env.PROD && !!posthogKey && !!posthogHost;

let ph: PostHog | null = null;
const queue: [string, Record<string, unknown>?][] = [];
if (import.meta.env.PROD && !on) console.warn('PostHog: VITE_POSTHOG_KEY or VITE_POSTHOG_HOST missing at build time, no analytics');
else if (on) void import('posthog-js').then(({ default: posthog }) => {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-08-30', // pageviews on history changes too: a ?place= link opened in the app counts
    person_profiles: 'identified_only',
    capture_pageleave: true,
    capture_performance: { web_vitals: true, network_timing: false },
    capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true, capture_console_errors: false },
    autocapture: false, rageclick: false, capture_dead_clicks: false, capture_heatmaps: false,
    disable_session_recording: true, disable_surveys: true, disable_product_tours: true, disable_conversations: true,
    disable_web_experiments: true, advanced_disable_flags: true,
  });
  ph = posthog;
  for (const [e, p] of queue.splice(0)) posthog.capture(e, p);
});

/** One of our own events: place_opened, model_opened, search_used, timeline_opened. */
export const capture = (event: string, properties?: Record<string, unknown>) => {
  if (!on) return;
  if (ph) ph.capture(event, properties); else queue.push([event, properties]);
};

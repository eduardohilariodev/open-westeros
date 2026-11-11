import posthog from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

if (!posthogKey || !posthogHost) {
  if (import.meta.env.DEV) {
    const missingVariable = posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
    throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
  }
} else {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-08-30',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: 'open-westeros-web',
      environment: import.meta.env.MODE,
    },
  });
}

export const capture = (event: string, properties?: Record<string, unknown>) => {
  if (posthogKey && posthogHost) posthog.capture(event, properties);
};

// Purpose-written atlas operation records only; existing console output stays local to the browser.
export const atlasLog = {
  info: (message: string, attributes: Record<string, string | number | boolean>) => {
    if (posthogKey && posthogHost) posthog.logger.info(message, attributes);
  },
};

export default posthog;

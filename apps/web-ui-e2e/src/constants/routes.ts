/**
 * Centralized route paths used across the E2E suite.
 * Keep this in sync with the web-ui App Router route groups.
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  dashboard: '/dashboard',
  sessions: '/sessions',
  settings: '/settings',
  agents: '/agents',
  inferences: '/inferences',
  chat: '/chat',
  docs: {
    root: '/docs',
    gettingStarted: '/docs/getting-started',
    installation: '/docs/installation',
    configuration: '/docs/configuration',
    apiReference: '/docs/api-reference',
    architecture: '/docs/architecture',
    faq: '/docs/faq',
  },
} as const;

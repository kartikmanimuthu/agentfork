// Mission Control is served under a path prefix on the shared CloudFront origin, so
// that web-ui keeps the root. Next.js applies `basePath` to <Link>, router navigation,
// next/image and static assets automatically — but NOT to fetch(). Every fetch to an
// own API route must go through this prefix or it lands on web-ui instead.
//
// next.config.ts reads the same constant, so the two can never drift.
// Nested under /claw-studio so every Claw Studio surface shares one prefix.
// Changing this moves the ALB listener rules and the health-check path with it
// (infra/compute/index.ts) and changes every integration's OAuth redirect URI,
// which is derived from NEXT_PUBLIC_MISSION_CONTROL_URL — see the OAuth note there.
export const BASE_PATH = '/claw-studio/mission-control';

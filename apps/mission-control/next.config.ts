import type { NextConfig } from 'next';
import './lib/env';
import { BASE_PATH } from './lib/base-path';

const nextConfig: NextConfig = {
  output: 'standalone',
  basePath: BASE_PATH,
  transpilePackages: ['@chatbot/shared', '@chatbot/ai', '@chatbot/claw-studio', '@chatbot/agent-studio', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  // pg-boss opens raw pg connections to enqueue gateway runs — bundling it
  // breaks its dynamic SQL loading, same reason @prisma/client is excluded.
  //
  // playwright resolves its browser binaries from disk at runtime via
  // PLAYWRIGHT_BROWSERS_PATH; bundling it breaks that lookup. Claw's browsing
  // tools pull it in through @chatbot/claw-studio, and web-ui already excludes
  // it for the same reason (apps/web-ui/next.config.ts).
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino', 'thread-stream', 'pg-boss', 'playwright', 'playwright-core'],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { workerThreads: false, cpus: 1 },
};

export default nextConfig;

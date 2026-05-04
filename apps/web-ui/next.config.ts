import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import './lib/env';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai', '@chatbot/knowledge-base', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino', 'thread-stream'],
};

export default withMDX(nextConfig);

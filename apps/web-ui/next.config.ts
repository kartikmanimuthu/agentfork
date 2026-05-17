import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import './lib/env';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai', '@chatbot/knowledge-base', '@chatbot/whatsapp', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino', 'thread-stream', '@ai-sdk/openai', '@ai-sdk/cohere', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'pdf-parse', 'mammoth', 'xlsx', 'umap-js'],
};

export default withMDX(nextConfig);

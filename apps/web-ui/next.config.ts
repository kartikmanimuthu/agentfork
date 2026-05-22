import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import './lib/env';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai', '@chatbot/knowledge-base', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino', 'thread-stream', '@ai-sdk/openai', '@ai-sdk/cohere', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'pdf-parse', 'mammoth', 'xlsx', 'umap-js'],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { workerThreads: false, cpus: 1 },
  async rewrites() {
    return [
      {
        source: '/sdk-assets/:path*',
        destination: 'http://localhost:3000/build/:path*',
      },
    ];
  },
};

export default withMDX(nextConfig);

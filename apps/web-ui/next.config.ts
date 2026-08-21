import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import './lib/env';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai', '@chatbot/knowledge-base', '@chatbot/whatsapp', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  serverExternalPackages: [
    '@prisma/client', 'bcryptjs', 'pino', 'thread-stream',
    '@ai-sdk/openai', '@ai-sdk/cohere',
    '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner',
    'pdf-parse', 'mammoth', 'xlsx', 'umap-js',
    // Crawlee + browser automation — use dynamic requires incompatible with webpack bundling
    'crawlee', '@crawlee/browser-pool', '@crawlee/playwright', '@crawlee/core',
    'playwright', 'playwright-core',
    'fingerprint-generator', 'header-generator',
    'browserslist',
  ],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { workerThreads: false, cpus: 1 },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        dns: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
  async redirects() {
    return [
      { source: '/transcription', destination: '/transcription/jobs', permanent: true },
      { source: '/transcription/playground', destination: '/transcription/jobs', permanent: true },
      { source: '/transcription/api-keys', destination: '/transcription/jobs', permanent: true },
      { source: '/transcription/models', destination: '/transcription/llm-providers', permanent: true },
      { source: '/transcription/models/:id/versions', destination: '/transcription/jobs', permanent: true },
      { source: '/transcription/models/:id', destination: '/transcription/llm-providers/:id', permanent: true },
      { source: '/transcription/s3-access', destination: '/transcription/llm-providers', permanent: true },
      { source: '/transcription/webhooks', destination: '/transcription/jobs', permanent: true },
    ];
  },
  async rewrites() {
    if (process.env.SDK_DEV) {
      return [
        {
          source: '/sdk-assets/:path*',
          destination: 'http://localhost:3007/build/:path*',
        },
      ];
    }
    return [];
  },
};

export default withMDX(nextConfig);

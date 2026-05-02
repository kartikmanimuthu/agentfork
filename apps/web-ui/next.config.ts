import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default withMDX(nextConfig);

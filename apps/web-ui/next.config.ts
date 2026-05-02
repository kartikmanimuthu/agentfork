import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default nextConfig;

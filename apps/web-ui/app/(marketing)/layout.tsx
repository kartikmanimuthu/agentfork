import type { ReactNode } from 'react';

export const metadata = {
  title: 'Chatbot — Open Source AI Agent Platform',
  description: 'Self-hosted, multi-tenant AI platform. Build agents, connect knowledge bases, integrate MCP tools, and deploy a chat widget.',
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="dark bg-[#09090b] min-h-screen text-[#fafafa]">{children}</div>;
}

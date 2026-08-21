import { McpServersClient } from '@/components/mcp/mcp-servers-client';

export default function McpPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <McpServersClient />
    </div>
  );
}

import { ConnectorsClient } from '@/components/connectors/connectors-client';

export default function ConnectorsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <ConnectorsClient />
    </div>
  );
}

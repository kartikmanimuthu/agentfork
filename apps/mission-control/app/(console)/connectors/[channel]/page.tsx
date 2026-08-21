import { notFound } from 'next/navigation';
import { ConnectorSettingsForm } from '@/components/connectors/connector-settings-form';
import type { ChannelId } from '@/hooks/use-connectors';

const SUPPORTED: ChannelId[] = ['slack', 'telegram', 'discord'];

export default async function ConnectorSettingsPage({
  params,
}: {
  params: Promise<{ channel: string }>;
}) {
  const { channel } = await params;
  if (!SUPPORTED.includes(channel as ChannelId)) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <ConnectorSettingsForm channel={channel as ChannelId} />
    </div>
  );
}

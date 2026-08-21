import { notFound } from 'next/navigation';
import { IntegrationAccountsForm } from '@/components/integrations/integration-accounts-form';
import type { IntegrationId } from '@/hooks/use-integrations';

const SUPPORTED: IntegrationId[] = [
  'github',
  'hubspot',
  'email',
  'notion',
  'gmail',
  'google_calendar',
  'google_drive',
  'outlook',
  'jira',
  'linear',
  'gitlab',
  'confluence',
  'zendesk',
  'clickup',
  'asana',
  'attio',
  'apollo',
  'hunter',
  'close',
  'stripe',
  'quickbooks',
  'docusign',
  'dropbox',
  'box',
  'posthog',
  'mixpanel',
  'amplitude',
  'figma',
  'canva',
  'whatsapp',
];

export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  if (!SUPPORTED.includes(integration as IntegrationId)) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <IntegrationAccountsForm integration={integration as IntegrationId} />
    </div>
  );
}

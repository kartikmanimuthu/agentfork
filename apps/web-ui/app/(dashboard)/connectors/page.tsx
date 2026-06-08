'use client';

import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import { Plug } from 'lucide-react';

const connectors = [
  {
    name: 'WhatsApp',
    description: 'Connect and manage WhatsApp Business accounts to send and receive messages.',
    icon: WhatsAppIcon,
    iconBg: 'bg-green-500/10',
    iconColor: 'text-green-600',
    href: '/settings/channels/whatsapp',
    comingSoon: false,
  },
  {
    name: 'Telegram',
    description: 'Connect Telegram bots to engage with users on the Telegram platform.',
    icon: TelegramIcon,
    iconBg: 'bg-sky-500/10',
    iconColor: 'text-sky-500',
    href: '/settings/channels/telegram',
    comingSoon: false,
  },
];

export default function ConnectorsPage() {
  const router = useRouter();

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Connectors</h2>
          <p className="text-sm text-muted-foreground">
            Connect your chatbot to messaging platforms and channels.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connectors.map((connector) => {
          const Icon = connector.icon;
          return (
            <Card
              key={connector.name}
              className={
                connector.comingSoon
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer hover:bg-accent/40 transition-colors'
              }
              onClick={() => {
                if (!connector.comingSoon && connector.href) {
                  router.push(connector.href);
                }
              }}
            >
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${connector.iconBg} ${connector.iconColor}`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  {connector.comingSoon && (
                    <Badge variant="secondary" className="text-xs">
                      Coming Soon
                    </Badge>
                  )}
                </div>
                <div>
                  <p className="font-semibold">{connector.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">{connector.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

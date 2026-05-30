'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import Link from 'next/link';
import { ChevronRight, Plug } from 'lucide-react';

const connectors = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Connect and manage WhatsApp Business accounts.',
    href: '/connectors/whatsapp',
    icon: WhatsAppIcon,
    iconClass: 'bg-green-500/10 text-green-600',
    comingSoon: false,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Connect and manage Telegram Bot accounts.',
    href: '#',
    icon: TelegramIcon,
    iconClass: 'bg-sky-500/10 text-sky-600',
    comingSoon: true,
  },
];

export default function ConnectorsPage() {
  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Connectors</h2>
            <p className="text-sm text-muted-foreground">
              Manage integrations with external channels and services.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {connectors.map((connector) => {
          const Icon = connector.icon;
          const card = (
            <Card
              key={connector.id}
              className={
                connector.comingSoon
                  ? 'opacity-60'
                  : 'hover:bg-accent/30 transition-colors'
              }
            >
              <CardContent className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${connector.iconClass}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{connector.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {connector.description}
                    </p>
                  </div>
                </div>
                {connector.comingSoon ? (
                  <Badge variant="secondary">Coming soon</Badge>
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </CardContent>
            </Card>
          );

          if (connector.comingSoon) {
            return card;
          }

          return (
            <Link href={connector.href} className="block" key={connector.id}>
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

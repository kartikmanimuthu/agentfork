import type { ComponentType, SVGProps } from 'react';
import { SiTelegram, SiDiscord } from '@icons-pack/react-simple-icons';
import type { ChannelId } from '@/hooks/use-connectors';
import { SlackLogo } from './slack-logo';

export interface ChannelVisual {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconBg: string;
  iconColor: string;
}

/**
 * Presentation-only, so it stays client-side rather than travelling through
 * the API (icons and Tailwind classes aren't serializable config). Real brand
 * logos, colored via the surrounding `iconColor` class the same way the rest
 * of the design system tints icons (not each brand's own exact hex).
 */
export const CHANNEL_VISUALS: Record<ChannelId, ChannelVisual> = {
  slack: { icon: SlackLogo, iconBg: 'bg-purple-500/10', iconColor: 'text-purple-600' },
  telegram: { icon: SiTelegram, iconBg: 'bg-sky-500/10', iconColor: 'text-sky-500' },
  discord: { icon: SiDiscord, iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-500' },
};

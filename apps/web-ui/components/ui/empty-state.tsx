import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

/**
 * One empty state for the whole app.
 *
 * `components/ui/empty` already existed but only two files used it: 25 others
 * hand-rolled their own, so "nothing here yet" looked different on nearly every
 * page — some centred, some left-aligned, some inside a Card, some a bare line of
 * muted text with no way to act on it. This wraps those primitives in the one
 * shape a list page actually needs, which is what makes adopting it a one-line
 * change at each call site.
 *
 * `action` matters as much as the copy: an empty state that only says "No agents
 * yet" leaves the user to find the create button themselves, and several of the
 * hand-rolled ones did exactly that.
 */
export interface EmptyStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The way out of the empty state — usually the primary create button. */
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <Empty className={cn('border-none', className)} {...props}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            {/* aria-hidden: the title already names the state, so announcing the
                icon would just repeat it. */}
            <Icon className="size-6" aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

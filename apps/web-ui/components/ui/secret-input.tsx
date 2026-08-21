'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Password/credential input with a show-hide toggle.
 *
 * Generalised from `ConnectorSecretField`, which had this behaviour but was tied
 * to that form's label/hint layout. This is the bare input, so it can replace a
 * `type="password"` Input anywhere without imposing surrounding markup.
 *
 * The eye reveals only what the user typed in THIS session. Stored credentials
 * are encrypted at rest and never returned to the browser in plaintext, so for a
 * saved key the field holds a mask and there is nothing further to show — which
 * is the point: it lets you check a pasted key before saving without making saved
 * secrets retrievable over HTTP.
 */
export type SecretInputProps = Omit<React.ComponentProps<typeof Input>, 'type'>;

export function SecretInput({ className, ...props }: SecretInputProps) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        // Room for the button so a long key never runs underneath it.
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Labelled for assistive tech and excluded from tab order's happy path is
        // NOT desirable here — reviewing a pasted secret is a keyboard task too.
        aria-label={visible ? 'Hide value' : 'Show value'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

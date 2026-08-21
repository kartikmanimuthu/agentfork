'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ConnectorSecretFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The stored value's mask, shown as the placeholder so the field can be left blank to keep it. */
  maskedValue?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

/**
 * Password input with a show/hide toggle. The eye only reveals what the user
 * typed in this session — stored secrets are never sent back to the browser in
 * plaintext, so there is nothing else it could show.
 */
export function ConnectorSecretField({
  id,
  label,
  value,
  onChange,
  maskedValue,
  placeholder,
  hint,
  required,
}: ConnectorSecretFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? null : <span className="ml-1 text-muted-foreground">(optional)</span>}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={maskedValue || placeholder}
          className="font-mono pr-10"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

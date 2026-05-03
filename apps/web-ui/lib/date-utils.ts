'use client';

import { useSession } from 'next-auth/react';

export function useTenantTimezone(): string {
  const { data: session } = useSession();
  return (session?.user as any)?.timezone ?? 'UTC';
}

export function getTimezoneOffset(timezone: string): string {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const diffMs = tzDate.getTime() - utcDate.getTime();
  const diffHours = Math.floor(Math.abs(diffMs) / 3600000);
  const diffMinutes = Math.floor((Math.abs(diffMs) % 3600000) / 60000);
  const sign = diffMs >= 0 ? '+' : '-';
  return `GMT${sign}${diffHours}${diffMinutes > 0 ? ':' + String(diffMinutes).padStart(2, '0') : ''}`;
}

export function formatDate(
  date: string | Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return 'Unknown';
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatted = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
    ...options,
  });
  return `${formatted} (${getTimezoneOffset(timezone)})`;
}

export function formatTimestamp(
  date: string | Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatted = d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    ...options,
  });
  return `${formatted} (${getTimezoneOffset(timezone)})`;
}

export function formatShortDateTime(
  date: string | Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return 'Unknown';
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatted = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    ...options,
  });
  return `${formatted} (${getTimezoneOffset(timezone)})`;
}

'use client';
// Merged into /transcription/jobs — next.config.ts handles a permanent redirect.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function WebhooksRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/transcription/jobs'); }, [router]);
  return null;
}

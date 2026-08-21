'use client';
// This page has moved to /transcription/jobs?provider=:id
// next.config.ts has a permanent server redirect; this is a client-side fallback.

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ModelVersionsRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  useEffect(() => { router.replace(`/transcription/jobs?provider=${id}`); }, [router, id]);
  return null;
}

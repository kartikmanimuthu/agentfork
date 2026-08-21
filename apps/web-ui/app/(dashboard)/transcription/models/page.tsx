'use client';
// This page has moved to /transcription/llm-providers
// next.config.ts has a permanent server redirect; this is a client-side fallback.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ModelsRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/transcription/llm-providers'); }, [router]);
  return null;
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TranscriptionRootRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/transcription/jobs'); }, [router]);
  return null;
}

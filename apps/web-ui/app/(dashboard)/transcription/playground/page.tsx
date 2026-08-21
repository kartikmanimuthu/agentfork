'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TranscriptionPlaygroundRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/transcription/jobs'); }, [router]);
  return null;
}

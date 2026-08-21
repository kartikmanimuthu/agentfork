'use client';
// S3 caller-bucket access has been removed. next.config.ts redirects /transcription/s3-access → /transcription.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function S3AccessRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/transcription'); }, [router]);
  return null;
}

'use client';

import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BASE_PATH } from '@/lib/base-path';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    // next-auth/react defaults its endpoint to /api/auth and does not know about
    // Next's basePath, so session, providers, signIn and signOut would all hit
    // web-ui's origin root and 404. Setting it here also configures the module-level
    // signIn/signOut helpers, which read the same value.
    <SessionProvider basePath={`${BASE_PATH}/api/auth`}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}

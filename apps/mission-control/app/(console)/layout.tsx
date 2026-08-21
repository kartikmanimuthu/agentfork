import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { ConsoleShell } from '@/components/console-shell';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // Middleware normally redirects unauthenticated visitors first — this is a
  // defensive fallback, pointing at Mission Control's own Studio login.
  if (!session?.studio?.clawId) {
    redirect('/login');
  }
  return <ConsoleShell studioId={session.studio.studioId}>{children}</ConsoleShell>;
}

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import Providers from './providers';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeConfigProvider } from '@/components/theme-config-provider';
import { cn } from '@/lib/utils';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'Operate your Claw',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(geistSans.variable, geistMono.variable)}>
      <body className="font-sans antialiased">
        <Providers>
          {/* disableTransitionOnChange removed on purpose: it works by
              injecting a blanket `* { transition: none }` for one frame on
              every toggle, which would kill the smooth color cross-fade
              (globals.css's `body { transition-colors }` plus shadcn's
              scoped `transition-colors` on individual components) that's the
              actual point of the new pill switcher. */}
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <ThemeConfigProvider>
              {children}
              <Toaster richColors position="top-center" />
            </ThemeConfigProvider>
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}

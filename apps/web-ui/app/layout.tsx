import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeConfigProvider } from '@/components/theme-config-provider';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Chatbot',
  description: 'AI-powered chatbot application',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(geistSans.variable, geistMono.variable)}>
      <body className="font-sans antialiased">
        <Providers>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem={true} disableTransitionOnChange>
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

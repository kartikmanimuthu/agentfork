import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeConfigProvider } from '@/components/theme-config-provider';
import { Toaster } from '@/components/ui/sonner';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Chatbot',
  description: 'AI-powered chatbot application',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <Providers>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <ThemeConfigProvider>
              {children}
              <Toaster richColors position="bottom-right" />
            </ThemeConfigProvider>
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}

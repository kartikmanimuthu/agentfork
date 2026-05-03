'use client';

import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

export function Footer() {
  return (
    <footer className="border-t bg-card py-4 px-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Chatbot</span>
          <span>&copy; {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
          <Link href="/settings" className="hover:text-foreground transition-colors">Settings</Link>
        </div>
      </div>
    </footer>
  );
}

'use client';

import Link from 'next/link';

export function Footer() {
  return (
    <footer role="contentinfo" className="border-t border-[#1f1f23] px-6 py-8">
      <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-[#52525b]">
        <span>AgentFork · MIT License · Built with Next.js &amp; AWS Bedrock</span>
        <div className="flex gap-4">
          <Link href="/docs" className="hover:text-[#fafafa] transition-colors">
            Docs
          </Link>
          <a
            href="https://github.com/kartikmanimuthu/chatbot"
            className="hover:text-[#fafafa] transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <Link
            href="/docs/user-guide/getting-started"
            className="hover:text-[#fafafa] transition-colors"
          >
            Getting Started
          </Link>
        </div>
      </div>
    </footer>
  );
}

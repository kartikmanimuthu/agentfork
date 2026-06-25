'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#27272a] backdrop-blur-md bg-[#09090b]/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold">
            <span className="bg-gradient-to-r from-[#a5b4fc] to-[#6366f1] bg-clip-text text-transparent">
              AgentFork
            </span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <a
              href="#features"
              className="text-sm text-[#a1a1aa] transition-colors hover:text-[#fafafa]"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-sm text-[#a1a1aa] transition-colors hover:text-[#fafafa]"
            >
              Pricing
            </a>
            <Link
              href="/docs"
              className="text-sm text-[#a1a1aa] transition-colors hover:text-[#fafafa]"
            >
              Docs
            </Link>
            <a
              href="https://github.com/kartikmanimuthu/agentfork"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a1a1aa] transition-colors hover:text-[#fafafa]"
            >
              <GithubIcon className="h-5 w-5" />
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-[#a1a1aa] transition-colors hover:text-[#fafafa]"
          >
            Sign in
          </Link>
          <Link href="/register">
            <Button
              size="sm"
              className="bg-[#6366f1] hover:bg-[#4f46e5] text-white border-none"
            >
              Get Started
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}

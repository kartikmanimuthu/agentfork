'use client'

import Link from 'next/link'
import { Github } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#27272a] backdrop-blur-md bg-[#09090b]/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold">
            <span className="bg-gradient-to-r from-[#a5b4fc] to-[#6366f1] bg-clip-text text-transparent">
              Chatbot
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
              href="https://github.com/kartikmanimuthu/chatbot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a1a1aa] transition-colors hover:text-[#fafafa]"
            >
              <Github className="h-5 w-5" />
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
          <Button
            asChild
            size="sm"
            className="bg-[#6366f1] hover:bg-[#4f46e5] text-white border-none"
          >
            <Link href="/register">Get Started</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

export function Hero() {
  return (
    <section
      className="relative overflow-hidden px-6 pb-24 pt-20 md:pt-32"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, rgba(99, 102, 241, 0.08) 0%, transparent 60%)',
      }}
    >
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto flex max-w-5xl flex-col items-center text-center"
      >
        {/* Badge pill */}
        <motion.div
          variants={item}
          className="border border-[#27272a] rounded-full px-4 py-1.5 text-xs text-[#a1a1aa]"
        >
          Open Source · MIT Licensed · Self-Hosted
        </motion.div>

        {/* Gradient headline */}
        <motion.h1
          variants={item}
          className="mt-8 text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-[-1.5px] leading-[1.1]"
        >
          <span className="block bg-gradient-to-r from-white to-[#a5b4fc] bg-clip-text text-transparent">
            The AI Agent Platform
          </span>
          <span className="block bg-gradient-to-r from-[#a5b4fc] to-[#6366f1] bg-clip-text text-transparent">
            You Can Own
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={item}
          className="mt-6 text-[#a1a1aa] text-base md:text-lg max-w-xl mx-auto leading-relaxed"
        >
          Build, deploy, and manage AI agents with knowledge bases, MCP tools,
          and multi-tenant isolation. Self-hosted on your infrastructure.
        </motion.p>

        {/* CTAs */}
        <motion.div variants={item} className="mt-8 flex items-center gap-4">
          <Link
            href="/register"
            className="bg-[#6366f1] hover:bg-[#4f46e5] text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Deploy Free →
          </Link>
          <a
            href="https://github.com/kartikmanimuthu/agentfork"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-[#27272a] text-[#d4d4d8] hover:border-[#3f3f46] px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Star on GitHub
          </a>
        </motion.div>

        {/* Product screenshot mockup */}
        <motion.div variants={item} className="mt-16 w-full max-w-4xl">
          <div
            className="rounded-xl p-[1px]"
            style={{
              background:
                'linear-gradient(180deg, rgba(99, 102, 241, 0.3) 0%, transparent 60%)',
            }}
          >
            <div className="rounded-xl overflow-hidden bg-[#111113]" style={{ borderRadius: 12 }}>
              {/* macOS title bar */}
              <div className="flex items-center gap-2 border-b border-[#27272a] px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              </div>

              {/* Dashboard wireframe */}
              <div className="flex h-64 md:h-80">
                {/* Sidebar */}
                <div className="w-[20%] border-r border-[#27272a] bg-[#18181b] p-4">
                  <div className="space-y-3">
                    <div className="h-2 w-3/4 rounded bg-[#27272a]" />
                    <div className="h-2 w-1/2 rounded bg-[#27272a]" />
                    <div className="h-2 w-2/3 rounded bg-[#27272a]" />
                    <div className="mt-6 h-2 w-3/4 rounded bg-[#27272a]" />
                    <div className="h-2 w-1/2 rounded bg-[#27272a]" />
                    <div className="h-2 w-2/3 rounded bg-[#27272a]" />
                  </div>
                </div>

                {/* Main content */}
                <div className="flex-1 p-4">
                  {/* Header bar */}
                  <div className="mb-4 flex items-center justify-between">
                    <div className="h-3 w-32 rounded bg-[#27272a]" />
                    <div className="h-3 w-20 rounded bg-[#6366f1]/30" />
                  </div>

                  {/* Agent cards grid */}
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-[#27272a] bg-[#18181b] p-3"
                      >
                        <div className="mb-2 h-2 w-2/3 rounded bg-[#27272a]" />
                        <div className="mb-1 h-2 w-full rounded bg-[#1f1f23]" />
                        <div className="mb-1 h-2 w-full rounded bg-[#1f1f23]" />
                        <div className="h-2 w-1/2 rounded bg-[#1f1f23]" />
                        <div className="mt-3 h-2 w-1/3 rounded bg-[#6366f1]/20" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}

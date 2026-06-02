'use client';

import { motion } from 'framer-motion';

export function QuickStart() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-24 text-center border-t border-[#1f1f23]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.5px]">
          Up and running in 60 seconds
        </h2>
        <p className="text-sm text-[#71717a] mt-2">
          Three commands. That&apos;s it.
        </p>

        <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 mt-8 text-left font-mono text-sm">
          <div className="text-[#71717a]"># Clone and install</div>
          <div className="text-[#a5b4fc]">$ git clone github.com/kartikmanimuthu/chatbot</div>
          <div className="text-[#a5b4fc]">$ cd chatbot && bun install</div>
          <div className="h-3" />
          <div className="text-[#71717a]"># Start everything</div>
          <div className="text-[#a5b4fc]">$ bun run dev:all</div>
        </div>
      </motion.div>
    </section>
  );
}

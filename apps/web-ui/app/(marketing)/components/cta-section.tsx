'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export function CTASection() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-24 text-center relative overflow-hidden border-t border-[#1f1f23]">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 100%, rgba(99, 102, 241, 0.06) 0%, transparent 60%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative"
      >
        <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.5px]">
          Ready to build your AI agents?
        </h2>
        <p className="text-sm text-[#71717a] mt-2">
          Deploy in under 5 minutes. Free, open source, self-hosted.
        </p>
        <Link
          href="/register"
          className="bg-[#6366f1] hover:bg-[#4f46e5] text-white px-6 py-3 rounded-lg font-medium mt-6 inline-block"
        >
          Get Started Free →
        </Link>
      </motion.div>
    </section>
  );
}

'use client';

import { motion } from 'framer-motion';

const features = [
  {
    label: 'AGENT STUDIO',
    heading: 'Build agents visually, test instantly',
    description:
      'Create AI agents with custom system prompts, attach knowledge bases, connect MCP tools, and test in a live playground — all from one interface.',
    reversed: false,
  },
  {
    label: 'KNOWLEDGE BASES',
    heading: 'RAG that just works',
    description:
      'Upload documents, sync web sources, and let pgvector handle semantic search. Your agents answer from your data, not hallucinations.',
    reversed: true,
  },
  {
    label: 'MCP SERVERS',
    heading: 'Connect any tool',
    description:
      'Integrate external APIs and tools via Model Context Protocol. Your agents can query databases, call APIs, and execute code — all during a conversation.',
    reversed: false,
  },
  {
    label: 'ANALYTICS',
    heading: "Know what's happening",
    description:
      'Track every inference, monitor token costs, and audit all platform activity. Real-time visibility into your AI operations.',
    reversed: true,
  },
];

function PlaceholderMockup({ type }: { type: number }) {
  if (type === 0) {
    // Agent Studio - sidebar + main panel mockup
    return (
      <div className="flex gap-3 w-3/4 h-2/3">
        <div className="flex flex-col gap-2 w-1/4">
          <div className="h-3 w-full rounded bg-[#27272a]" />
          <div className="h-3 w-3/4 rounded bg-[#27272a]" />
          <div className="h-3 w-5/6 rounded bg-[#27272a]" />
          <div className="h-3 w-2/3 rounded bg-[#6366f1]/30" />
          <div className="h-3 w-3/4 rounded bg-[#27272a]" />
        </div>
        <div className="flex-1 rounded-lg border border-[#27272a] p-3 flex flex-col gap-2">
          <div className="h-3 w-1/2 rounded bg-[#27272a]" />
          <div className="h-3 w-full rounded bg-[#27272a]" />
          <div className="h-3 w-4/5 rounded bg-[#27272a]" />
          <div className="mt-auto h-6 w-1/3 rounded bg-[#6366f1]/20 border border-[#6366f1]/40" />
        </div>
      </div>
    );
  }
  if (type === 1) {
    // Knowledge Bases - document list mockup
    return (
      <div className="flex flex-col gap-3 w-3/4 h-2/3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-[#27272a] p-3"
          >
            <div className="h-8 w-8 rounded bg-[#6366f1]/20 shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="h-2.5 w-2/3 rounded bg-[#27272a]" />
              <div className="h-2 w-1/3 rounded bg-[#27272a]/60" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (type === 2) {
    // MCP Servers - connected tools grid
    return (
      <div className="grid grid-cols-3 gap-2 w-3/4 h-2/3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-[#27272a] flex flex-col items-center justify-center gap-2 p-2"
          >
            <div className="h-6 w-6 rounded bg-[#6366f1]/20" />
            <div className="h-2 w-3/4 rounded bg-[#27272a]" />
          </div>
        ))}
      </div>
    );
  }
  // Analytics - chart mockup
  return (
    <div className="flex flex-col gap-3 w-3/4 h-2/3">
      <div className="flex items-end gap-1.5 flex-1">
        {[40, 65, 45, 80, 55, 70, 90, 60, 75, 85].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-[#6366f1]/20 border border-[#6366f1]/30"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="h-[1px] w-full bg-[#27272a]" />
      <div className="flex justify-between">
        <div className="h-2 w-12 rounded bg-[#27272a]" />
        <div className="h-2 w-12 rounded bg-[#27272a]" />
        <div className="h-2 w-12 rounded bg-[#27272a]" />
      </div>
    </div>
  );
}

export function FeatureShowcase() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-24">
      {features.map((feature, index) => (
        <motion.div
          key={feature.label}
          initial={{ opacity: 0, x: feature.reversed ? 30 : -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className={`flex flex-col md:flex-row items-center gap-10 md:gap-16 py-16 ${
            index > 0 ? 'border-t border-[#1f1f23]' : ''
          } ${feature.reversed ? 'md:flex-row-reverse' : ''}`}
        >
          <div className="flex-1">
            <p className="text-[11px] text-[#6366f1] uppercase tracking-[1px] font-medium">
              {feature.label}
            </p>
            <h3 className="text-2xl md:text-3xl font-bold tracking-[-0.5px] mt-3">
              {feature.heading}
            </h3>
            <p className="text-[15px] text-[#71717a] leading-relaxed mt-3">
              {feature.description}
            </p>
          </div>
          <div className="flex-1 w-full">
            <div className="bg-[#111113] border border-[#27272a] rounded-xl h-[200px] md:h-[280px] flex items-center justify-center">
              <PlaceholderMockup type={index} />
            </div>
          </div>
        </motion.div>
      ))}
    </section>
  );
}

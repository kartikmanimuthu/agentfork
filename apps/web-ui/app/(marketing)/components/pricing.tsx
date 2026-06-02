'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const tiers = [
  {
    title: 'Self-Hosted',
    price: '$0',
    sub: 'forever',
    features: ['All features included', 'Unlimited users', 'Unlimited agents', 'Community support'],
    cta: 'Deploy Now',
    ctaHref: 'https://github.com/kartikmanimuthu/chatbot',
    highlighted: true,
  },
  {
    title: 'Cloud',
    price: 'Coming soon',
    sub: 'Managed hosting',
    features: ['Zero infrastructure', 'Automatic updates', 'Priority support'],
    cta: null,
    ctaHref: null,
    highlighted: false,
  },
  {
    title: 'Enterprise',
    price: 'Custom',
    sub: 'Dedicated support',
    features: ['SLA guarantees', 'Custom integrations', 'On-premise option', 'Dedicated support'],
    cta: null,
    ctaHref: null,
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-[#1f1f23]">
      <div className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.5px]">
          Free forever. No catch.
        </h2>
        <p className="text-sm text-[#71717a] mt-2">
          Self-host and own your data. No usage limits, no vendor lock-in.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12">
          {tiers.map((tier) => {
            const Card = tier.highlighted ? motion.div : 'div';
            const cardProps = tier.highlighted
              ? { whileHover: { scale: 1.02 }, transition: { type: 'spring', stiffness: 300, damping: 20 } }
              : {};

            return (
              <Card
                key={tier.title}
                className={`bg-[#111113] border rounded-xl p-6 text-left relative ${
                  tier.highlighted ? 'border-[#6366f1]' : 'border-[#27272a] opacity-60'
                }`}
                {...cardProps}
              >
                {tier.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#6366f1] text-white text-[10px] font-medium px-3 py-0.5 rounded-full">
                    Popular
                  </span>
                )}

                <h3 className="text-sm font-semibold">{tier.title}</h3>
                <p className="text-3xl font-extrabold mt-2">{tier.price}</p>
                <p className="text-xs text-[#71717a]">{tier.sub}</p>

                <ul className="mt-4 space-y-2">
                  {tier.features.map((feature) => (
                    <li key={feature} className="text-xs text-[#a1a1aa] flex items-center gap-2">
                      <Check className="w-3 h-3 text-[#6366f1] shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {tier.cta && tier.ctaHref && (
                  <a
                    href={tier.ctaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 block w-full text-center border border-[#27272a] text-[#d4d4d8] hover:border-[#3f3f46] py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {tier.cta}
                  </a>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

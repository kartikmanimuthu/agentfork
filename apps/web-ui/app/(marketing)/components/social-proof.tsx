'use client';

import {
  motion,
  useInView,
  useMotionValue,
  useTransform,
  animate,
} from 'framer-motion';
import { useRef, useEffect } from 'react';

function CountUp({ target, suffix }: { target: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));

  useEffect(() => {
    if (isInView) {
      const controls = animate(count, target, {
        duration: 1.5,
        ease: 'easeOut',
      });
      return controls.stop;
    }
  }, [isInView, target, count]);

  return (
    <span ref={ref}>
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

const stats = [
  { value: 12, suffix: '+', label: 'Core Features', isNumeric: true },
  { value: 0, suffix: '', label: 'Licensed', display: 'MIT', isNumeric: false },
  {
    value: 100,
    suffix: '%',
    label: 'Self-Hosted',
    isNumeric: true,
  },
  {
    value: 0,
    suffix: '',
    label: 'No Usage Limits',
    display: '∞',
    isNumeric: false,
  },
];

export function SocialProof() {
  return (
    <section className="border-t border-b border-[#1f1f23] bg-[#111113]/50">
      <div className="max-w-4xl mx-auto py-12 px-6">
        <div className="flex justify-around items-center">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center">
              <span className="text-3xl md:text-4xl font-bold text-[#fafafa]">
                {stat.isNumeric ? (
                  <CountUp target={stat.value} suffix={stat.suffix} />
                ) : (
                  stat.display
                )}
              </span>
              <span className="text-xs text-[#71717a] mt-1">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

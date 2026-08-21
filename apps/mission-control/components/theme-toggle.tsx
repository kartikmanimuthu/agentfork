'use client';

import { useEffect, useState } from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Three-way pill switcher (System / Light / Dark), replacing the old
 * dropdown menu. A single `motion.span` with a shared `layoutId` slides
 * smoothly between segments instead of the active option just appearing —
 * that's the whole "smooth switch" ask; framer-motion's spring physics on
 * `layout` handles the animation, nothing hand-rolled.
 */

const OPTIONS = [
  { value: 'system', icon: Monitor, label: 'Match system' },
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // `theme` is undefined until next-themes reads localStorage client-side —
  // rendering the pill before that would briefly highlight the wrong segment
  // (or none), so hold off until mounted rather than guess.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="glass inline-flex items-center gap-0.5 rounded-full p-1">
      {OPTIONS.map((opt) => {
        const isActive = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            aria-label={opt.label}
            aria-pressed={isActive}
            className={cn(
              'relative flex h-7 w-7 items-center justify-center rounded-full transition-colors',
              // Bold accent-colored icon on a light frosted fill, not a solid
              // block with an inverted icon — the flat `bg-primary` circle
              // read as too heavy.
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="theme-toggle-active"
                className="glass-active absolute inset-0 rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            )}
            <opt.icon className="relative z-10 h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

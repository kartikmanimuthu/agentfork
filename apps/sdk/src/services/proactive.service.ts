import type { ProactiveRule } from '../types';

export class ProactiveService {
  private timers: number[] = [];
  private scrollHandler: (() => void) | null = null;

  evaluate(rules: ProactiveRule[], onTrigger: (message: string) => void): void {
    this.cleanup();

    for (const rule of rules) {
      switch (rule.trigger) {
        case 'time':
          if (rule.delay) {
            const timer = window.setTimeout(() => onTrigger(rule.message), rule.delay);
            this.timers.push(timer);
          }
          break;

        case 'scroll':
          if (rule.scrollPercent) {
            const threshold = rule.scrollPercent;
            this.scrollHandler = () => {
              const scrolled = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
              if (scrolled >= threshold) {
                onTrigger(rule.message);
                if (this.scrollHandler) {
                  window.removeEventListener('scroll', this.scrollHandler);
                  this.scrollHandler = null;
                }
              }
            };
            window.addEventListener('scroll', this.scrollHandler, { passive: true });
          }
          break;

        case 'url':
          if (rule.urlPattern) {
            const regex = new RegExp(rule.urlPattern);
            if (regex.test(window.location.href)) {
              window.setTimeout(() => onTrigger(rule.message), 1000);
            }
          }
          break;
      }
    }
  }

  cleanup(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }
}

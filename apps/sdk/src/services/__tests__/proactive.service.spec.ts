import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveService } from '../proactive.service';
import type { ProactiveRule } from '../../types';

describe('ProactiveService', () => {
  let service: ProactiveService;
  let onTrigger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ProactiveService();
    onTrigger = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('time trigger', () => {
    it('fires callback after specified delay', () => {
      const rules: ProactiveRule[] = [{ trigger: 'time', delay: 5000, message: 'Hello!' }];
      service.evaluate(rules, onTrigger);

      expect(onTrigger).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5000);
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onTrigger).toHaveBeenCalledWith('Hello!');
    });

    it('fires multiple time triggers with different delays', () => {
      const rules: ProactiveRule[] = [
        { trigger: 'time', delay: 3000, message: 'First' },
        { trigger: 'time', delay: 7000, message: 'Second' },
      ];
      service.evaluate(rules, onTrigger);

      vi.advanceTimersByTime(3000);
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onTrigger).toHaveBeenCalledWith('First');

      vi.advanceTimersByTime(4000);
      expect(onTrigger).toHaveBeenCalledTimes(2);
      expect(onTrigger).toHaveBeenCalledWith('Second');
    });

    it('does not set timer when delay is falsy (0)', () => {
      const rules: ProactiveRule[] = [{ trigger: 'time', delay: 0, message: 'Hi' }];
      service.evaluate(rules, onTrigger);

      vi.runAllTimers();
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('does not set timer when delay is undefined', () => {
      const rules: ProactiveRule[] = [{ trigger: 'time', message: 'Hi' }];
      service.evaluate(rules, onTrigger);

      vi.runAllTimers();
      expect(onTrigger).not.toHaveBeenCalled();
    });
  });

  describe('scroll trigger', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        value: 2000,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 1000,
        writable: true,
        configurable: true,
      });
    });

    it('fires callback when scroll percentage reaches threshold', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 50, message: 'Halfway!' }];
      service.evaluate(rules, onTrigger);

      // scrollHeight(2000) - innerHeight(1000) = 1000 scrollable
      // scrollY=500 → 50%
      (window as any).scrollY = 500;
      window.dispatchEvent(new Event('scroll'));

      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onTrigger).toHaveBeenCalledWith('Halfway!');
    });

    it('fires callback when scroll exceeds threshold', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 30, message: 'Scrolled!' }];
      service.evaluate(rules, onTrigger);

      (window as any).scrollY = 600; // 60%
      window.dispatchEvent(new Event('scroll'));

      expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('does not fire when scroll below threshold', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 50, message: 'Halfway!' }];
      service.evaluate(rules, onTrigger);

      (window as any).scrollY = 499; // 49.9%
      window.dispatchEvent(new Event('scroll'));

      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('fires exactly at threshold boundary (>=)', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 50, message: 'Halfway!' }];
      service.evaluate(rules, onTrigger);

      (window as any).scrollY = 500; // exactly 50%
      window.dispatchEvent(new Event('scroll'));

      expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('removes listener after firing (fires only once)', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 50, message: 'Halfway!' }];
      service.evaluate(rules, onTrigger);

      (window as any).scrollY = 500;
      window.dispatchEvent(new Event('scroll'));
      expect(onTrigger).toHaveBeenCalledTimes(1);

      // scroll more
      (window as any).scrollY = 800;
      window.dispatchEvent(new Event('scroll'));
      expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('does not set listener when scrollPercent is undefined', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', message: 'Hi' }];
      service.evaluate(rules, onTrigger);

      (window as any).scrollY = 500;
      window.dispatchEvent(new Event('scroll'));
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('does not set listener when scrollPercent is 0 (falsy check)', () => {
      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 0, message: 'Immediate' }];
      service.evaluate(rules, onTrigger);

      (window as any).scrollY = 100;
      window.dispatchEvent(new Event('scroll'));
      expect(onTrigger).not.toHaveBeenCalled();
    });
  });

  describe('url trigger', () => {
    it('fires callback when URL matches pattern', () => {
      const originalHref = window.location.href;
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/pricing' },
        writable: true,
        configurable: true,
      });

      const rules: ProactiveRule[] = [
        { trigger: 'url', urlPattern: '/pricing', message: 'Check our pricing!' },
      ];
      service.evaluate(rules, onTrigger);

      vi.advanceTimersByTime(1000);
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onTrigger).toHaveBeenCalledWith('Check our pricing!');

      // Restore
      Object.defineProperty(window, 'location', {
        value: { href: originalHref },
        writable: true,
        configurable: true,
      });
    });

    it('does not fire when URL does not match pattern', () => {
      const rules: ProactiveRule[] = [
        { trigger: 'url', urlPattern: '/pricing', message: 'Check pricing!' },
      ];
      service.evaluate(rules, onTrigger);

      vi.advanceTimersByTime(2000);
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('does not set timer when urlPattern is undefined', () => {
      const rules: ProactiveRule[] = [{ trigger: 'url', message: 'Hi' }];
      service.evaluate(rules, onTrigger);

      vi.runAllTimers();
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('fires for URL matching regex pattern', () => {
      const originalHref = window.location.href;
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/blog/post-1' },
        writable: true,
        configurable: true,
      });

      const rules: ProactiveRule[] = [
        { trigger: 'url', urlPattern: '/blog/', message: 'Reading our blog?' },
      ];
      service.evaluate(rules, onTrigger);

      vi.advanceTimersByTime(1000);
      expect(onTrigger).toHaveBeenCalledTimes(1);

      Object.defineProperty(window, 'location', {
        value: { href: originalHref },
        writable: true,
        configurable: true,
      });
    });
  });

  describe('cleanup', () => {
    it('clears all timers and prevents callbacks from firing', () => {
      const rules: ProactiveRule[] = [
        { trigger: 'time', delay: 5000, message: 'Hello' },
        { trigger: 'time', delay: 10000, message: 'World' },
      ];
      service.evaluate(rules, onTrigger);
      service.cleanup();

      vi.advanceTimersByTime(15000);
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('removes scroll listener', () => {
      Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        value: 2000,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 1000,
        writable: true,
        configurable: true,
      });

      const rules: ProactiveRule[] = [{ trigger: 'scroll', scrollPercent: 50, message: 'Hey!' }];
      service.evaluate(rules, onTrigger);
      service.cleanup();

      (window as any).scrollY = 600;
      window.dispatchEvent(new Event('scroll'));
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('is called before evaluate (clears previous rules first)', () => {
      const rules1: ProactiveRule[] = [{ trigger: 'time', delay: 5000, message: 'Old' }];
      const rules2: ProactiveRule[] = [{ trigger: 'time', delay: 3000, message: 'New' }];

      service.evaluate(rules1, onTrigger);
      service.evaluate(rules2, onTrigger);

      vi.advanceTimersByTime(3000);
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onTrigger).toHaveBeenCalledWith('New');

      vi.advanceTimersByTime(2000);
      expect(onTrigger).toHaveBeenCalledTimes(1); // old timer was cleared
    });
  });

  describe('mixed rules', () => {
    it('evaluates multiple different rule types simultaneously', () => {
      Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        value: 2000,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 1000,
        writable: true,
        configurable: true,
      });

      const rules: ProactiveRule[] = [
        { trigger: 'time', delay: 5000, message: 'Timed' },
        { trigger: 'scroll', scrollPercent: 50, message: 'Scrolled' },
      ];
      service.evaluate(rules, onTrigger);

      // Scroll first
      (window as any).scrollY = 500;
      window.dispatchEvent(new Event('scroll'));
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onTrigger).toHaveBeenCalledWith('Scrolled');

      // Then time
      vi.advanceTimersByTime(5000);
      expect(onTrigger).toHaveBeenCalledTimes(2);
      expect(onTrigger).toHaveBeenCalledWith('Timed');
    });
  });

  describe('edge cases', () => {
    it('handles empty rules array', () => {
      expect(() => service.evaluate([], onTrigger)).not.toThrow();
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('handles rules with unknown trigger type gracefully', () => {
      const rules: ProactiveRule[] = [
        { trigger: 'unknown' as any, message: 'Weird' },
      ];
      expect(() => service.evaluate(rules, onTrigger)).not.toThrow();
      expect(onTrigger).not.toHaveBeenCalled();
    });
  });
});

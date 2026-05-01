import { VerticalExecutor } from './vertical.js';
import { HorizontalExecutor } from './horizontal.js';
import type { JobExecutor } from './types.js';

export function createExecutor(arch: string): JobExecutor {
  switch (arch) {
    case 'vertical':
      return new VerticalExecutor();
    case 'horizontal':
      return new HorizontalExecutor();
    default:
      throw new Error(`Unknown WORKER_ARCH: "${arch}". Valid values: vertical, horizontal`);
  }
}

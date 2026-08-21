import { describe, it, expect, afterEach } from 'vitest';
import { memoryLogVerbose } from './log';

afterEach(() => { delete process.env.MEMORY_LOG_VERBOSE; });

describe('memoryLogVerbose', () => {
    it('defaults true; false/0 disable', () => {
        expect(memoryLogVerbose()).toBe(true);
        process.env.MEMORY_LOG_VERBOSE = 'false';
        expect(memoryLogVerbose()).toBe(false);
        process.env.MEMORY_LOG_VERBOSE = '0';
        expect(memoryLogVerbose()).toBe(false);
    });
});

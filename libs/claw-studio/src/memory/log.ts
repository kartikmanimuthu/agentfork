/** Memory observability: summary log lines are always on; full content dumps are gated here. */
export function memoryLogVerbose(): boolean {
    const v = process.env.MEMORY_LOG_VERBOSE?.toLowerCase();
    return !(v === 'false' || v === '0');
}

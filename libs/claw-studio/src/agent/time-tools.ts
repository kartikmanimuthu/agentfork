import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:agent:time-tools');

/**
 * The current time, from the process rather than from the internet.
 *
 * Claw had no time tool and no date in its system prompt, so the only way it
 * could answer "what happened this week" was to `web_fetch` a public time API and
 * guess the route: `worldtimeapi.org` (connection reset), then
 * `timeapi.io/get/time?city=London` (404 — the real route is
 * `/api/Time/current/zone?timeZone=…`). Three failed calls, their error output in
 * context, and a wrong answer available for free from `Date`.
 *
 * `Intl.DateTimeFormat` does the zone conversion, so DST is correct by
 * construction — the arithmetic an 8B model gets wrong for half the year.
 *
 * `now` is injectable purely so tests can pin a clock; production passes nothing.
 */
export interface TimeToolsOptions {
  now?: () => Date;
}

export function createTimeTools(options: TimeToolsOptions = {}) {
  const clock = options.now ?? (() => new Date());

  return [
    tool(
      async (input: { timeZone?: string }) => {
        try {
          const at = clock();
          const zone = input.timeZone?.trim();

          // The weekday is returned, not left to the model. Asked the time in Tokyo
          // with no weekday in the result, it answered "Monday, August 18, 2026" —
          // a Tuesday. Deriving a day name from a date is exactly the arithmetic a
          // heavily quantized model gets confidently wrong, so the tool does it.
          const weekdayIn = (timeZone: string): string =>
            new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(at);

          if (!zone) {
            return `Current time: ${weekdayIn('UTC')}, ${at.toISOString().replace('T', ' ').slice(0, 19)} UTC (ISO: ${at.toISOString()})`;
          }

          // Throws RangeError on an unknown zone, which is what the catch turns
          // into a recoverable message — a thrown tool error would abort the run.
          const formatted = new Intl.DateTimeFormat('en-GB', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(at);

          const [date, time] = formatted.split(', ');
          const iso = date.split('/').reverse().join('-');
          // Weekday of the TARGET zone, not of UTC: at 23:30 UTC on a Tuesday it is
          // already Wednesday in Tokyo, and reporting Tuesday there would be wrong.
          return `Current time in ${zone}: ${weekdayIn(zone)}, ${iso} ${time} (UTC now: ${at.toISOString()})`;
        } catch (error) {
          logger.warn({ error, timeZone: input.timeZone }, 'get_current_time failed');
          return `Error reading the current time for "${input.timeZone}": ${
            error instanceof Error ? error.message : String(error)
          }. Use an IANA zone name such as "Europe/London" or omit it for UTC.`;
        }
      },
      {
        name: 'get_current_time',
        description:
          'Get the current date and time, optionally in a specific IANA time zone (e.g. "Europe/London", "Asia/Kolkata"). Use this instead of fetching a time API from the web.',
        schema: z.object({
          timeZone: z
            .string()
            .optional()
            .describe('IANA time zone name, e.g. "Europe/London". Omit for UTC.'),
        }),
      },
    ),
  ];
}

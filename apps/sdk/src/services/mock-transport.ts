import type { StreamEvent } from '../types';
import { SCENARIOS, type ScenarioKey, type ScriptedEvent } from './mock-scenarios';

export class MockTransport {
  constructor(private scenario: ScenarioKey = 'thinking') {}

  setScenario(scenario: ScenarioKey) {
    this.scenario = scenario;
  }

  // Mirrors StreamService.parseSSE(response): AsyncGenerator<StreamEvent>
  async *parseSSE(): AsyncGenerator<StreamEvent> {
    const script: ScriptedEvent[] = SCENARIOS[this.scenario] ?? SCENARIOS.thinking;
    for (const { event, delayMs } of script) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield event;
    }
  }
}

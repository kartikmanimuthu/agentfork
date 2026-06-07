export type CommandResult =
  | { type: 'reset' }
  | { type: 'switch'; agentName: string | undefined }
  | { type: 'help' };

const COMMANDS = ['start', 'reset', 'help'] as const;

export class TelegramCommandHandler {
  parse(text: string): CommandResult | null {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0];

    if (!COMMANDS.includes(command as any)) return null;

    switch (command) {
      case 'start':
        return { type: 'help' };
      case 'reset':
        return { type: 'reset' };
      case 'help':
        return { type: 'help' };
      default:
        return null;
    }
  }
}

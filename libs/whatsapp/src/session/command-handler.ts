export type CommandResult =
  | { type: 'reset' }
  | { type: 'switch'; agentName: string | undefined }
  | { type: 'help' };

const COMMANDS = ['reset', 'switch', 'help'] as const;

export class CommandHandler {
  parse(text: string): CommandResult | null {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0];

    if (!COMMANDS.includes(command as any)) return null;

    switch (command) {
      case 'reset':
        return { type: 'reset' };
      case 'switch':
        return { type: 'switch', agentName: parts[1] || undefined };
      case 'help':
        return { type: 'help' };
      default:
        return null;
    }
  }
}

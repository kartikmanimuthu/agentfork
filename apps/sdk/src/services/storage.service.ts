const PREFIX = 'smc_widget_';

export class StorageService {
  private readonly sdkId: string;

  constructor(sdkId: string) {
    this.sdkId = sdkId;
  }

  private key(name: string): string {
    return `${PREFIX}${this.sdkId}_${name}`;
  }

  getVisitorId(): string {
    const existing = localStorage.getItem(this.key('visitor_id'));
    if (existing) return existing;

    const id = `v_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    localStorage.setItem(this.key('visitor_id'), id);
    return id;
  }

  getSessionId(): string | null {
    return localStorage.getItem(this.key('session_id'));
  }

  setSessionId(id: string): void {
    localStorage.setItem(this.key('session_id'), id);
  }

  clearSession(): void {
    localStorage.removeItem(this.key('session_id'));
  }

  getTheme(): string | null {
    return localStorage.getItem(this.key('theme'));
  }

  setTheme(theme: string): void {
    localStorage.setItem(this.key('theme'), theme);
  }

  getPreChatDone(): boolean {
    return localStorage.getItem(this.key('prechat_done')) === 'true';
  }

  setPreChatDone(done: boolean): void {
    localStorage.setItem(this.key('prechat_done'), String(done));
  }
}

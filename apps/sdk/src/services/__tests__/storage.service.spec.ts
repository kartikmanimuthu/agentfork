import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageService } from '../storage.service';

describe('StorageService', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const proto = Object.getPrototypeOf(window.localStorage);
    vi.spyOn(proto, 'getItem').mockImplementation((key: string) => store[key] ?? null);
    vi.spyOn(proto, 'setItem').mockImplementation((key: string, val: string) => {
      store[key] = String(val);
    });
    vi.spyOn(proto, 'removeItem').mockImplementation((key: string) => {
      delete store[key];
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');
  });

  describe('getVisitorId', () => {
    it('generates a new visitor ID on first call', () => {
      const service = new StorageService('sdk_1');
      const id = service.getVisitorId();

      expect(id).toBe('v_0000000000000000');
      expect(store['smc_widget_sdk_1_visitor_id']).toBe('v_0000000000000000');
    });

    it('returns existing visitor ID on subsequent calls', () => {
      store['smc_widget_sdk_1_visitor_id'] = 'v_existing12345678';

      const service = new StorageService('sdk_1');
      const id = service.getVisitorId();

      expect(id).toBe('v_existing12345678');
    });
  });

  describe('session ID management', () => {
    it('getSessionId returns null when not set', () => {
      const service = new StorageService('sdk_1');
      expect(service.getSessionId()).toBeNull();
    });

    it('setSessionId and getSessionId round-trip', () => {
      const service = new StorageService('sdk_1');
      service.setSessionId('sess_abc123');
      expect(service.getSessionId()).toBe('sess_abc123');
      expect(store['smc_widget_sdk_1_session_id']).toBe('sess_abc123');
    });

    it('clearSession removes stored session ID', () => {
      store['smc_widget_sdk_1_session_id'] = 'sess_abc123';
      const service = new StorageService('sdk_1');
      service.clearSession();
      expect(service.getSessionId()).toBeNull();
      expect(store['smc_widget_sdk_1_session_id']).toBeUndefined();
    });

    it('setSessionId overwrites previous value', () => {
      const service = new StorageService('sdk_1');
      service.setSessionId('sess_1');
      service.setSessionId('sess_2');
      expect(service.getSessionId()).toBe('sess_2');
    });
  });

  describe('theme management', () => {
    it('getTheme returns null when not set', () => {
      const service = new StorageService('sdk_1');
      expect(service.getTheme()).toBeNull();
    });

    it('setTheme and getTheme round-trip', () => {
      const service = new StorageService('sdk_1');
      service.setTheme('dark');
      expect(service.getTheme()).toBe('dark');
      expect(store['smc_widget_sdk_1_theme']).toBe('dark');
    });

    it('setTheme overwrites previous value', () => {
      const service = new StorageService('sdk_1');
      service.setTheme('dark');
      service.setTheme('light');
      expect(service.getTheme()).toBe('light');
    });
  });

  describe('preChatDone management', () => {
    it('getPreChatDone returns false when not set', () => {
      const service = new StorageService('sdk_1');
      expect(service.getPreChatDone()).toBe(false);
    });

    it('setPreChatDone and getPreChatDone round-trip (true)', () => {
      const service = new StorageService('sdk_1');
      service.setPreChatDone(true);
      expect(service.getPreChatDone()).toBe(true);
      expect(store['smc_widget_sdk_1_prechat_done']).toBe('true');
    });

    it('setPreChatDone and getPreChatDone round-trip (false)', () => {
      const service = new StorageService('sdk_1');
      service.setPreChatDone(true);
      service.setPreChatDone(false);
      expect(service.getPreChatDone()).toBe(false);
      expect(store['smc_widget_sdk_1_prechat_done']).toBe('false');
    });

    it('getPreChatDone returns false for any non-"true" value', () => {
      store['smc_widget_sdk_1_prechat_done'] = 'false';
      const service = new StorageService('sdk_1');
      expect(service.getPreChatDone()).toBe(false);
    });
  });

  describe('key scoping', () => {
    it('scopes keys by sdkId', () => {
      const sdk1 = new StorageService('sdk_1');
      const sdk2 = new StorageService('sdk_2');

      sdk1.setSessionId('sess_1');
      sdk2.setSessionId('sess_2');

      expect(sdk1.getSessionId()).toBe('sess_1');
      expect(sdk2.getSessionId()).toBe('sess_2');
      expect(store['smc_widget_sdk_1_session_id']).toBe('sess_1');
      expect(store['smc_widget_sdk_2_session_id']).toBe('sess_2');
    });

    it('keys follow the pattern smc_widget_{sdkId}_{name}', () => {
      const service = new StorageService('my_sdk');
      service.setSessionId('sess_test');
      service.setTheme('dark');

      expect(store['smc_widget_my_sdk_session_id']).toBe('sess_test');
      expect(store['smc_widget_my_sdk_theme']).toBe('dark');
    });

    it('clearing one sdkId does not affect another', () => {
      store['smc_widget_sdk_1_session_id'] = 'sess_1';
      store['smc_widget_sdk_2_session_id'] = 'sess_2';

      const sdk1 = new StorageService('sdk_1');
      sdk1.clearSession();

      expect(sdk1.getSessionId()).toBeNull();
      const sdk2 = new StorageService('sdk_2');
      expect(sdk2.getSessionId()).toBe('sess_2');
    });
  });
});

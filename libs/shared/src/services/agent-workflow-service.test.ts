import { describe, it, expect, vi } from 'vitest';
import { AgentWorkflowService, type AgentWorkflowDb } from './agent-workflow-service';

function fakeDb(existing: any = null): AgentWorkflowDb & { _rows: any[] } {
  const _rows: any[] = existing ? [existing] : [];
  return {
    _rows,
    agentWorkflow: {
      findFirst: vi.fn(async ({ where }: any) => _rows.find((r) => r.agentId === where.agentId) ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: 'w1', isActive: false, version: 1, ...data }; _rows.push(row); return row; }),
      update: vi.fn(async ({ where, data }: any) => { const r = _rows.find((x) => x.id === where.id); Object.assign(r, data); return r; }),
    },
  } as any;
}

const def = { entryNodeId: 'a', nodes: [{ id: 'a', type: 'text', text: 'hi' }], transitions: [] } as any;

describe('AgentWorkflowService', () => {
  it('getByAgent returns null when none exists', async () => {
    const svc = new AgentWorkflowService('t1', fakeDb());
    expect(await svc.getByAgent('ag1')).toBeNull();
  });
  it('upsert creates when absent', async () => {
    const db = fakeDb();
    const svc = new AgentWorkflowService('t1', db);
    await svc.upsert('ag1', def);
    expect(db.agentWorkflow.create).toHaveBeenCalledOnce();
    expect(db._rows[0]).toMatchObject({ agentId: 'ag1', tenantId: 't1', definition: def });
  });
  it('upsert updates when present, preserving isActive', async () => {
    const db = fakeDb({ id: 'w1', agentId: 'ag1', tenantId: 't1', isActive: true, version: 1, definition: { old: true } });
    const svc = new AgentWorkflowService('t1', db);
    await svc.upsert('ag1', def);
    expect(db.agentWorkflow.update).toHaveBeenCalledOnce();
    expect(db._rows[0].definition).toEqual(def);
    expect(db._rows[0].isActive).toBe(true);
  });
  it('setActive flips the flag', async () => {
    const db = fakeDb({ id: 'w1', agentId: 'ag1', tenantId: 't1', isActive: false, version: 1, definition: def });
    const svc = new AgentWorkflowService('t1', db);
    await svc.setActive('ag1', true);
    expect(db._rows[0].isActive).toBe(true);
  });
  it('setActive throws when no workflow exists', async () => {
    const svc = new AgentWorkflowService('t1', fakeDb());
    await expect(svc.setActive('ag1', true)).rejects.toThrow();
  });
});

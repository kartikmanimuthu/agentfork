import type { SkillDTO } from '@chatbot/claw-studio/skills/skill-export';
import { BASE_PATH } from '@/lib/base-path';

export type { SkillDTO } from '@chatbot/claw-studio/skills/skill-export';

export interface SkillInput {
  name: string;
  description: string;
  tier: string;
  content: string;
  isEnabled?: boolean;
  slug?: string;
  source?: string;
  sourceRunId?: string | null;
}

async function jsonOrThrow(res: Response) {
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const ClientSkillService = {
  async listSkills(all = true): Promise<SkillDTO[]> {
    const res = await fetch(`${BASE_PATH}/api/skills${all ? '?all=1' : ''}`);
    const body = await jsonOrThrow(res);
    return body.skills as SkillDTO[];
  },
  /** List skills with their full `content` (used for markdown/zip export). */
  async listSkillsWithContent(all = true): Promise<SkillDTO[]> {
    const params = new URLSearchParams();
    if (all) params.set('all', '1');
    params.set('withContent', '1');
    const res = await fetch(`${BASE_PATH}/api/skills?${params.toString()}`);
    const body = await jsonOrThrow(res);
    return body.skills as SkillDTO[];
  },
  async getSkill(id: string): Promise<SkillDTO> {
    return (await jsonOrThrow(await fetch(`${BASE_PATH}/api/skills/${id}`))).data;
  },
  async createSkill(input: SkillInput): Promise<SkillDTO> {
    return (
      await jsonOrThrow(
        await fetch(`${BASE_PATH}/api/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
    ).data;
  },
  async updateSkill(id: string, input: Partial<SkillInput>): Promise<SkillDTO> {
    return (
      await jsonOrThrow(
        await fetch(`${BASE_PATH}/api/skills/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
    ).data;
  },
  async deleteSkill(id: string): Promise<void> {
    await jsonOrThrow(await fetch(`${BASE_PATH}/api/skills/${id}`, { method: 'DELETE' }));
  },
  async distill(transcript: string): Promise<{ name: string; description: string; tier: string; content: string }> {
    return (
      await jsonOrThrow(
        await fetch(`${BASE_PATH}/api/skills/distill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
        }),
      )
    ).data;
  },
};

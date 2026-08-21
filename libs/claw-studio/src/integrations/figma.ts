/**
 * figma.ts — Figma tool-only integration: a single personal access token per
 * tenant, read tools for files/comments/image export and an approval-gated
 * write tool for posting comments. Figma's own auth convention is a bare
 * `X-Figma-Token` header, not `Authorization: Bearer` — deliberately not
 * normalized to match the other connectors here.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:figma');

const FIGMA_API = 'https://api.figma.com/v1';
const NOT_CONNECTED = 'Figma is not connected. Connect a personal access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Figma API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function figmaHeaders(accessToken: string): Record<string, string> {
  // Figma's own convention: a bare token header, not Authorization: Bearer.
  return { 'X-Figma-Token': accessToken };
}

async function figmaRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${FIGMA_API}${path}`, {
    ...init,
    headers: { ...figmaHeaders(accessToken), 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  children?: FigmaNode[];
}

/**
 * Recursively caps a Figma node tree at `depth` levels of children — a raw
 * Figma file's node tree can be enormous even after `truncateOutput`'s char
 * cap kicks in, so this bounds the *shape* of what gets serialized in the
 * first place rather than truncating mid-JSON. Beyond `depth`, children are
 * collapsed to a bare count instead of being walked further.
 */
function figmaSummarize(node: FigmaNode, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, name: node.name, type: node.type };
  const children = node.children ?? [];
  if (depth > 0 && children.length > 0) {
    out.children = children.map((child) => figmaSummarize(child, depth - 1));
  } else if (children.length > 0) {
    out.child_count = children.length;
  }
  return out;
}

export const figmaDescriptor: IntegrationDescriptor = {
  name: 'figma',
  displayName: 'Figma',
  description: 'Read design files and comments; export assets.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    if (!accessToken) return { ok: false, error: 'A personal access token is required.' };
    try {
      const me = (await figmaRequest(accessToken, '/me')) as { email?: string };
      if (!me.email) return { ok: false, error: 'Figma did not return an account email for this token.' };
      return { ok: true, detail: `Connected as ${me.email}`, meta: { email: me.email } };
    } catch (error) {
      logger.warn({ error }, 'Figma verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Figma verification failed' };
    }
  },
};

export function createFigmaTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, figmaDescriptor);

  const figma_get_file = tool(
    async ({ fileKey }: { fileKey: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        // depth=2 bounds what Figma itself sends back; figmaSummarize then
        // caps the shape we serialize on top of that.
        const data = (await figmaRequest(
          accessToken,
          `/files/${encodeURIComponent(fileKey)}?depth=2`,
        )) as { name?: string; lastModified?: string; document?: FigmaNode };
        const pages = (data.document?.children ?? []).map((page) => figmaSummarize(page, 1));
        const result = { name: data.name, last_modified: data.lastModified, pages };
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, fileKey }, 'figma_get_file failed');
        return `Error fetching Figma file: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'figma_get_file',
      description: "Read a Figma file's pages and top-level frames (the file key is in the file's URL).",
      schema: z.object({ fileKey: z.string().describe('Figma file key, from the file URL') }),
    },
  );

  const figma_get_comments = tool(
    async ({ fileKey }: { fileKey: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const comments = await figmaRequest(accessToken, `/files/${encodeURIComponent(fileKey)}/comments`);
        return truncateOutput(JSON.stringify(comments, null, 2), 2000);
      } catch (error) {
        logger.error({ error, fileKey }, 'figma_get_comments failed');
        return `Error fetching Figma comments: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'figma_get_comments',
      description: 'List comments on a Figma file.',
      schema: z.object({ fileKey: z.string().describe('Figma file key, from the file URL') }),
    },
  );

  const figma_post_comment = tool(
    async ({ fileKey, message, replyTo }: { fileKey: string; message: string; replyTo?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const body: Record<string, unknown> = { message };
        if (replyTo) body.comment_id = replyTo;
        const comment = await figmaRequest(accessToken, `/files/${encodeURIComponent(fileKey)}/comments`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return truncateOutput(JSON.stringify(comment, null, 2), 1000);
      } catch (error) {
        logger.error({ error, fileKey }, 'figma_post_comment failed');
        return `Error posting Figma comment: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'figma_post_comment',
      description: 'Comment on a Figma file, optionally replying to an existing comment. Requires approval.',
      schema: z.object({
        fileKey: z.string().describe('Figma file key, from the file URL'),
        message: z.string().describe('Comment text'),
        replyTo: z.string().optional().describe('Id of the comment to reply to, if this is a reply'),
      }),
    },
  );

  const figma_export_images = tool(
    async ({
      fileKey,
      nodeIds,
      format = 'png',
      scale = 2,
    }: {
      fileKey: string;
      nodeIds: string;
      format?: string;
      scale?: number;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const params = new URLSearchParams({ ids: nodeIds, format, scale: String(scale) });
        const result = await figmaRequest(accessToken, `/images/${encodeURIComponent(fileKey)}?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 1500);
      } catch (error) {
        logger.error({ error, fileKey, nodeIds }, 'figma_export_images failed');
        return `Error exporting Figma images: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'figma_export_images',
      description: 'Render Figma nodes to image URLs (node ids comma-separated; format png/svg/pdf).',
      schema: z.object({
        fileKey: z.string().describe('Figma file key, from the file URL'),
        nodeIds: z.string().describe('Comma-separated Figma node ids to render'),
        format: z.enum(['png', 'svg', 'pdf']).optional().describe('Export format, defaults to png'),
        scale: z.number().optional().describe('Export scale factor, defaults to 2'),
      }),
    },
  );

  return [figma_get_file, figma_get_comments, figma_post_comment, figma_export_images];
}

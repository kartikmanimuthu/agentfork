import type { ParsedEvent, WebhookContact, WebhookInboundMessage, WebhookStatus } from './types';

interface NetcoreIncomingMessage {
  message_id: string;
  from: string;
  to: string;
  from_name?: string;
  received_at: string;
  message_type?: string;
  text_type?: { text: string };
  image_type?: { id: string; mime_type: string; sha256: string };
  video_type?: { id: string; mime_type: string; sha256: string };
  audio_type?: { id: string; mime_type: string; sha256: string; voice?: boolean };
  document_type?: { id: string; mime_type: string; sha256: string; filename?: string };
  location_type?: { latitude: string; longitude: string; name?: string; address?: string; url?: string };
  reaction_type?: { emoji: string };
}

export interface NetcoreWebhookPayload {
  incoming_message?: NetcoreIncomingMessage[];
}

export interface NetcoreDeliveryStatus {
  ncmessage_id: string;
  phoneNumber?: string;
  received_at: string;
  recipient?: string;
  source?: string;
  status: string;
  status_remark?: string;
}

export interface NetcoreDeliveryPayload {
  delivery_status?: NetcoreDeliveryStatus[];
}

export function parseNetcoreWebhookPayload(payload: NetcoreWebhookPayload): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const raw of payload.incoming_message ?? []) {
    const message = buildMessage(raw);
    if (!message) continue;

    const contact: WebhookContact = { profile: { name: raw.from_name ?? '' }, wa_id: raw.from };
    events.push({ type: 'message', phoneNumberId: raw.to, contact, message });
  }

  return events;
}

export function parseNetcoreDeliveryStatus(payload: NetcoreDeliveryPayload): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const raw of payload.delivery_status ?? []) {
    if (!raw.ncmessage_id) continue;

    const status = normalizeDeliveryStatus(raw.status);
    const errors = status === 'failed' && raw.status_remark
      ? [{ code: 0, title: 'failed', message: raw.status_remark }]
      : undefined;

    events.push({
      type: 'status',
      phoneNumberId: raw.phoneNumber ?? '',
      status: {
        id: raw.ncmessage_id,
        status,
        timestamp: raw.received_at,
        recipient_id: raw.recipient ?? '',
        errors,
      },
    });
  }

  return events;
}

function normalizeDeliveryStatus(status: string): WebhookStatus['status'] {
  const lowered = status.toLowerCase();
  if (lowered === 'sent' || lowered === 'delivered' || lowered === 'read' || lowered === 'failed') {
    return lowered;
  }
  return lowered as WebhookStatus['status'];
}

function buildMessage(raw: NetcoreIncomingMessage): WebhookInboundMessage | null {
  const base = { from: raw.from, id: raw.message_id, timestamp: raw.received_at };
  const type = raw.message_type?.toLowerCase();

  switch (type) {
    case 'text':
      return raw.text_type ? { ...base, type: 'text', text: { body: raw.text_type.text } } : null;
    case 'image':
      return raw.image_type ? { ...base, type: 'image', image: raw.image_type } : null;
    case 'video':
      return raw.video_type ? { ...base, type: 'video', video: raw.video_type } : null;
    case 'audio':
      return raw.audio_type ? { ...base, type: 'audio', audio: raw.audio_type } : null;
    case 'document':
      return raw.document_type ? { ...base, type: 'document', document: raw.document_type } : null;
    case 'location':
      return raw.location_type ? { ...base, type: 'location', location: raw.location_type } : null;
    case 'reaction':
      return raw.reaction_type ? { ...base, type: 'reaction', reaction: raw.reaction_type } : null;
    default:
      return null;
  }
}

import type { WebhookPayload, ParsedEvent, WebhookContact } from './types';

export function parseWebhookPayload(payload: WebhookPayload): ParsedEvent[] {
  if (payload.object !== 'whatsapp_business_account') {
    return [];
  }

  const events: ParsedEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      const phoneNumberId = value.metadata.phone_number_id;
      const contactMap = new Map<string, WebhookContact>();

      if (value.contacts) {
        for (const contact of value.contacts) {
          contactMap.set(contact.wa_id, contact);
        }
      }

      if (value.messages) {
        for (const message of value.messages) {
          const contact = contactMap.get(message.from) ?? {
            profile: { name: '' },
            wa_id: message.from,
          };
          events.push({ type: 'message', phoneNumberId, contact, message });
        }
      }

      if (value.statuses) {
        for (const status of value.statuses) {
          events.push({ type: 'status', phoneNumberId, status });
        }
      }

      if (value.errors) {
        for (const error of value.errors) {
          events.push({ type: 'error', phoneNumberId, error });
        }
      }
    }
  }

  return events;
}

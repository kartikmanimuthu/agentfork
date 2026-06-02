export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: string;
}

export interface WebhookValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: WebhookContact[];
  messages?: WebhookInboundMessage[];
  statuses?: WebhookStatus[];
  errors?: WebhookError[];
}

export interface WebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface WebhookInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'interactive' | 'button';
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text: string; payload: string };
}

export interface WebhookStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WebhookError[];
}

export interface WebhookError {
  code: number;
  title: string;
  message: string;
  error_data?: { details: string };
}

export type ParsedEvent =
  | { type: 'message'; phoneNumberId: string; contact: WebhookContact; message: WebhookInboundMessage }
  | { type: 'status'; phoneNumberId: string; status: WebhookStatus }
  | { type: 'error'; phoneNumberId: string; error: WebhookError };

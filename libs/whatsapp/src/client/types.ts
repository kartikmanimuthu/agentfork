export interface SendTextMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface SendImageMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'image';
  image: { id?: string; link?: string; caption?: string };
}

export interface SendDocumentMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'document';
  document: { id?: string; link?: string; caption?: string; filename?: string };
}

export interface SendInteractiveMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: InteractiveMessage;
}

export interface InteractiveMessage {
  type: 'button' | 'list';
  header?: { type: 'text'; text: string };
  body: { text: string };
  footer?: { text: string };
  action: InteractiveAction;
}

export interface InteractiveAction {
  buttons?: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
  button?: string;
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
}

export interface SendTemplateMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: { name: string; language: { code: string }; components?: TemplateComponent[] };
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: Array<{ type: 'text'; text: string } | { type: 'image'; image: { link: string } }>;
  sub_type?: string;
  index?: number;
}

export type SendMessageRequest =
  | SendTextMessageRequest
  | SendImageMessageRequest
  | SendDocumentMessageRequest
  | SendInteractiveMessageRequest
  | SendTemplateMessageRequest;

export interface SendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

export interface UploadMediaResponse {
  id: string;
}

export interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}

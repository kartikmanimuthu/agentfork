import { describe, it, expect } from 'vitest';
import { parseNetcoreWebhookPayload, parseNetcoreDeliveryStatus } from './netcore-parser';
import type { NetcoreDeliveryPayload } from './netcore-parser';

describe('parseNetcoreWebhookPayload', () => {
  it('parses a text message', () => {
    const payload = {
      incoming_message: [{
        received_at: '1782241255',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Test User',
        to: '919711750243',
        message_type: 'TEXT',
        text_type: { text: 'Hello' },
        message_id: 'wamid.abc123',
        from: '917020184728',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: '919711750243',
      contact: { profile: { name: 'Test User' }, wa_id: '917020184728' },
      message: { from: '917020184728', id: 'wamid.abc123', timestamp: '1782241255', type: 'text', text: { body: 'Hello' } },
    });
  });

  it('parses an image message', () => {
    const payload = {
      incoming_message: [{
        to: '919711750243',
        message_type: 'IMAGE',
        image_type: { mime_type: 'image/jpeg', sha256: 'abc==', id: '12345' },
        message_id: 'wamid.img1',
        from: '918287240391',
        received_at: '1782274577',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Image Sender',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: '919711750243',
      contact: { profile: { name: 'Image Sender' }, wa_id: '918287240391' },
      message: { from: '918287240391', id: 'wamid.img1', timestamp: '1782274577', type: 'image', image: { id: '12345', mime_type: 'image/jpeg', sha256: 'abc==' } },
    });
  });

  it('parses a video message', () => {
    const payload = {
      incoming_message: [{
        to: '919711750243',
        message_type: 'VIDEO',
        video_type: { mime_type: 'video/mp4', sha256: 'xyz==', id: '67890' },
        message_id: 'wamid.vid1',
        from: '918826603017',
        received_at: '1782282621',
        context: { message_id: '', ncmessage_id: '' },
        from_name: 'Video Sender',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events[0].type).toBe('message');
    expect((events[0] as any).message.type).toBe('video');
    expect((events[0] as any).message.video).toEqual({ id: '67890', mime_type: 'video/mp4', sha256: 'xyz==' });
  });

  it('parses an audio (voice note) message', () => {
    const payload = {
      incoming_message: [{
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Voice Sender',
        to: '919711750243',
        message_type: 'AUDIO',
        audio_type: { mime_type: 'audio/ogg; codecs=opus', sha256: 'aaa==', id: '111', voice: true },
        message_id: 'wamid.aud1',
        from: '918826603017',
        received_at: '1782282927',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.audio).toEqual({ id: '111', mime_type: 'audio/ogg; codecs=opus', sha256: 'aaa==', voice: true });
  });

  it('parses a document message', () => {
    const payload = {
      incoming_message: [{
        to: '919711750243',
        message_type: 'DOCUMENT',
        document_type: { filename: 'report.pdf', mime_type: 'application/pdf', sha256: 'bbb==', id: '222' },
        message_id: 'wamid.doc1',
        from: '918826603017',
        received_at: '1782282698',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Doc Sender',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.document).toEqual({ id: '222', mime_type: 'application/pdf', sha256: 'bbb==', filename: 'report.pdf' });
  });

  it('parses a location message', () => {
    const payload = {
      incoming_message: [{
        location_type: { latitude: '28.64', longitude: '77.18', name: 'Place', address: '123 St', url: 'https://example.com' },
        message_id: 'wamid.loc1',
        from: '918826603017',
        received_at: '1782282727',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Location Sender',
        to: '919711750243',
        message_type: 'LOCATION',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.location).toEqual({ latitude: '28.64', longitude: '77.18', name: 'Place', address: '123 St', url: 'https://example.com' });
  });

  it('parses a reaction message', () => {
    const payload = {
      incoming_message: [{
        from_name: 'Reactor',
        message_type: 'REACTION',
        to: '919711750243',
        reaction_type: { emoji: '👍' },
        message_id: 'wamid.react1',
        from: '919413001085',
        received_at: '1782281169',
        context: { ncmessage_id: 'e693eb1d-347e', message_id: 'wamid.original', 'x-apiheader': '' },
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.reaction).toEqual({ emoji: '👍' });
  });

  it('skips a message with no recognized message_type instead of throwing', () => {
    const payload = {
      incoming_message: [{
        from_name: 'Omar Hussain',
        to: '919711750243',
        message_id: 'wamid.unknown1',
        from: '918826603017',
        received_at: '1782282738',
        context: { ncmessage_id: '', message_id: '' },
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(0);
  });

  it('returns empty array when incoming_message is missing', () => {
    const events = parseNetcoreWebhookPayload({});
    expect(events).toHaveLength(0);
  });

  it('handles multiple messages in one payload', () => {
    const payload = {
      incoming_message: [
        { to: '919711750243', message_type: 'TEXT', text_type: { text: 'Hi' }, message_id: 'wamid.1', from: '91111', received_at: '1' },
        { to: '919711750243', message_type: 'TEXT', text_type: { text: 'Hello' }, message_id: 'wamid.2', from: '91222', received_at: '2' },
      ],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(2);
  });
});

describe('parseNetcoreDeliveryStatus', () => {
  it('parses a delivered status event', () => {
    const payload = {
      delivery_status: [{
        ncmessage_id: 'bab1e073-51c9-4566-8008-30d33b6bedfd',
        phoneNumber: '919711750243',
        received_at: '1764585432',
        recipient: '918826603017',
        source: '',
        status: 'delivered',
        status_remark: '',
      }],
    };

    const events = parseNetcoreDeliveryStatus(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'status',
      phoneNumberId: '919711750243',
      status: {
        id: 'bab1e073-51c9-4566-8008-30d33b6bedfd',
        status: 'delivered',
        timestamp: '1764585432',
        recipient_id: '918826603017',
        errors: undefined,
      },
    });
  });

  it('maps a failed status remark into errors so it lands on the message row', () => {
    const payload = {
      delivery_status: [{
        ncmessage_id: 'fail-1',
        phoneNumber: '919711750243',
        received_at: '1764585440',
        recipient: '918826603017',
        status: 'failed',
        status_remark: 'Recipient not opted in',
      }],
    };

    const events = parseNetcoreDeliveryStatus(payload);
    expect(events).toHaveLength(1);
    expect((events[0] as any).status.status).toBe('failed');
    expect((events[0] as any).status.errors).toEqual([{ code: 0, title: 'failed', message: 'Recipient not opted in' }]);
  });

  it('normalizes status case and passes unknown statuses through', () => {
    const payload = {
      delivery_status: [
        { ncmessage_id: 'a', phoneNumber: '919711750243', received_at: '1', recipient: '91', status: 'READ' },
        { ncmessage_id: 'b', phoneNumber: '919711750243', received_at: '2', recipient: '91', status: 'clicked' },
      ],
    };

    const events = parseNetcoreDeliveryStatus(payload);
    expect(events).toHaveLength(2);
    expect((events[0] as any).status.status).toBe('read');
    expect((events[1] as any).status.status).toBe('clicked');
  });

  it('skips entries without an ncmessage_id', () => {
    const payload = {
      delivery_status: [
        { phoneNumber: '919711750243', received_at: '1', recipient: '91', status: 'sent' },
        { ncmessage_id: 'ok', phoneNumber: '919711750243', received_at: '2', recipient: '91', status: 'sent' },
      ],
    } as unknown as NetcoreDeliveryPayload;

    const events = parseNetcoreDeliveryStatus(payload);
    expect(events).toHaveLength(1);
    expect((events[0] as any).status.id).toBe('ok');
  });

  it('returns empty array when delivery_status is missing', () => {
    expect(parseNetcoreDeliveryStatus({})).toHaveLength(0);
  });
});

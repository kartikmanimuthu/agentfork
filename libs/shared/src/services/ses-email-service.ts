import { EmailService, EmailMessage } from './email-service';
import { createLogger } from '../logging/logger';

const logger = createLogger('ses-email-service');

export class SESEmailService implements EmailService {
  private fromEmail: string;

  constructor(fromEmail: string) {
    this.fromEmail = fromEmail;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    try {
      const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
      const client = new SESClient({});
      await client.send(
        new SendEmailCommand({
          Source: this.fromEmail,
          Destination: { ToAddresses: [message.to] },
          Message: {
            Subject: { Data: message.subject },
            Body: {
              Text: { Data: message.text },
              ...(message.html ? { Html: { Data: message.html } } : {}),
            },
          },
        }),
      );
      logger.info({ to: message.to, subject: message.subject }, 'SES email sent successfully');
    } catch (err) {
      logger.error({ err, to: message.to }, 'Failed to send SES email');
      throw err;
    }
  }
}

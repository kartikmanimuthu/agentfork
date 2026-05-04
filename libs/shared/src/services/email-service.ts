import { createLogger } from '../logging/logger';

const logger = createLogger('email-service');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailService {
  sendEmail(message: EmailMessage): Promise<void>;
}

class ConsoleEmailService implements EmailService {
  async sendEmail(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject },
      `Email would be sent to ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  }
}

let emailServiceInstance: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = new ConsoleEmailService();
  }
  return emailServiceInstance;
}

export function setEmailService(service: EmailService): void {
  emailServiceInstance = service;
}

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface SendMessageDto {
  message_type: string;
  subject?: string;
  message_body: string;
  recipients: Array<{ email?: string; name?: string; id?: string }>;
  deal_id?: string;
  attachments?: Array<{ filename: string; content?: string; size?: number }>;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendMessage(userId: string, dto: SendMessageDto) {
    const { message_type, subject, message_body, recipients, deal_id, attachments = [] } = dto;

    if (!recipients?.length) throw new BadRequestException('At least one recipient is required');
    if (!message_body) throw new BadRequestException('Message body is required');

    let status = 'sent';
    let errorMessage: string | null = null;

    if (message_type === 'email') {
      const resendApiKey = this.config.get<string>('resend.apiKey');
      if (!resendApiKey) throw new InternalServerErrorException('Email service not configured');

      const senderUser = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { full_name: true, email: true },
      });

      const fromName = senderUser?.full_name || 'Private Lending 360';
      const recipientEmails = recipients.map((r) => r.email).filter(Boolean) as string[];

      if (!recipientEmails.length) {
        throw new BadRequestException('No valid email addresses in recipients');
      }

      const resendAttachments = attachments
        .filter((a) => a.content && a.filename)
        .map((a) => ({ filename: a.filename, content: a.content }));

      const emailPayload: Record<string, unknown> = {
        from: `${fromName} <onboarding@resend.dev>`,
        to: recipientEmails,
        subject: subject || '(No Subject)',
        html: `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${message_body.replace(/\n/g, '<br/>')}</div>`,
      };
      if (resendAttachments.length > 0) emailPayload.attachments = resendAttachments;

      const resendResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailPayload),
      });

      if (!resendResp.ok) {
        const errText = await resendResp.text();
        let parsedMsg = errText;
        try {
          parsedMsg = (JSON.parse(errText) as { message?: string }).message || errText;
        } catch { /* JSON.parse failed — use raw error text */ }
        status = 'failed';
        if (resendResp.status === 403 && parsedMsg.includes('only send testing emails')) {
          errorMessage =
            'Email service is in test mode. Verify a sending domain and use a domain-based From address to send to external recipients.';
        } else {
          errorMessage = `Email send failed: ${parsedMsg}`;
        }
      }
    } else if (message_type === 'sms') {
      status = 'pending';
      errorMessage = 'SMS sending is not yet configured';
    }

    try {
      await this.prisma.messages.create({
        data: {
          sender_id: userId,
          deal_id: deal_id || null,
          message_type,
          subject: subject || null,
          body: message_body,
          recipients: recipients,
          attachments: attachments.map((a) => ({ filename: a.filename, size: a.size })) as Prisma.InputJsonValue,
          status,
          error_message: errorMessage,
        } as unknown as Prisma.messagesUncheckedCreateInput,
      });
    } catch (err) {
      this.logger.error('Error storing message record:', err);
    }

    return { success: status === 'sent', status, error: errorMessage };
  }
}

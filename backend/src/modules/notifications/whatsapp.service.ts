import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { Rendered } from './events';

/**
 * WhatsApp delivery. Business-initiated WhatsApp messages need pre-approved
 * templates on Meta's Cloud API or a BSP (Gupshup, Interakt, AiSensy...). Until
 * a provider account is configured, the "log" provider records what would be sent.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger('WhatsApp');
  private readonly provider: 'log' | 'disabled';

  constructor(config: ConfigService<Env, true>) {
    this.provider = config.get('WHATSAPP_PROVIDER', { infer: true });
  }

  get enabled() {
    return this.provider !== 'disabled';
  }

  get providerName() {
    return this.provider;
  }

  /** `to` is an Indian 10-digit mobile; sent as +91. */
  async send(to: string, message: Rendered, absoluteLink?: string): Promise<{ messageId: string }> {
    const e164 = `+91${to}`;
    this.logger.log(`[${this.provider}] WhatsApp to ${e164}: ${message.title}${absoluteLink ? ` ${absoluteLink}` : ''}`);
    return { messageId: `log-${Date.now()}` };
  }
}

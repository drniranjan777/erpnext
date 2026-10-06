import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars from 'handlebars';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';
import type { Rendered } from './events';

export interface OutgoingMail {
  to: string;
  toName?: string | null;
  workspace: string;
  message: Rendered;
}

/** Branded, table-based HTML that renders in Gmail/Outlook. Values are HTML-escaped by Handlebars. */
const layout = Handlebars.compile(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title></head>
<body style="margin:0;background:#f6f7f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e6eb;border-radius:12px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e3e6eb;font-weight:600;color:#1d4ed8">NextGen ERP · {{workspace}}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:18px">{{title}}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">{{#if toName}}Hi {{toName}},<br><br>{{/if}}{{body}}</p>
{{#if url}}<a href="{{url}}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">{{action}}</a>
<p style="margin:16px 0 0;font-size:12px;color:#5b6474">Or open: <a href="{{url}}" style="color:#1d4ed8;word-break:break-all">{{url}}</a></p>{{/if}}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e3e6eb;font-size:11px;color:#5b6474">You received this because of your notification settings in NextGen ERP. Manage them under My account → Notifications.</td></tr>
</table></td></tr></table></body></html>`);

/**
 * Sends email via SMTP when SMTP_URL is set; otherwise writes .eml files to
 * MAIL_DIR so developers can open them (no external service needed).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter;
  private readonly mode: 'smtp' | 'file';
  private readonly from: string;
  private readonly appUrl: string;
  private readonly mailDir: string;

  constructor(config: ConfigService<Env, true>) {
    const smtp = config.get('SMTP_URL', { infer: true });
    this.mode = smtp ? 'smtp' : 'file';
    this.transport = smtp ? nodemailer.createTransport(smtp) : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    this.from = config.get('EMAIL_FROM', { infer: true });
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    this.mailDir = resolve(config.get('MAIL_DIR', { infer: true }));
  }

  get provider() {
    return this.mode === 'smtp' ? 'smtp' : 'file';
  }

  absoluteUrl(link?: string) {
    if (!link) return undefined;
    return /^https?:\/\//.test(link) ? link : `${this.appUrl}${link}`;
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    const url = this.absoluteUrl(mail.message.link);
    const html = layout({ ...mail.message, url, toName: mail.toName, workspace: mail.workspace });
    const text = `${mail.toName ? `Hi ${mail.toName},\n\n` : ''}${mail.message.body}${url ? `\n\n${mail.message.action ?? 'Open'}: ${url}` : ''}\n\n- NextGen ERP · ${mail.workspace}`;
    const info = await this.transport.sendMail({
      from: this.from,
      to: mail.toName ? { name: mail.toName, address: mail.to } : mail.to,
      subject: mail.message.title,
      text,
      html,
    });
    if (this.mode === 'file') {
      await mkdir(this.mailDir, { recursive: true });
      const file = join(this.mailDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mail.to.replace(/[^a-z0-9@._-]/gi, '_')}.eml`);
      await writeFile(file, info.message as Buffer);
      this.logger.log(`[dev] Email to ${mail.to} "${mail.message.title}" → ${file}`);
    }
    return { messageId: info.messageId };
  }
}

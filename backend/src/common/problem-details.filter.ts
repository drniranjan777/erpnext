import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** PostgreSQL error codes we translate into client errors. */
const PG_ERRORS: Record<string, { status: number; title: string }> = {
  '23505': { status: HttpStatus.CONFLICT, title: 'Duplicate record' },
  '23503': { status: HttpStatus.CONFLICT, title: 'Referenced record missing or in use' },
  '42501': { status: HttpStatus.FORBIDDEN, title: 'Access denied' },
};

/**
 * Formats every error as RFC 7807 `application/problem+json`.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal server error';
    let detail: string | undefined;
    let errors: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      title = HttpStatus[status]?.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) ?? title;
      if (typeof body === 'string') detail = body;
      else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; errors?: unknown };
        detail = Array.isArray(b.message) ? b.message.join('; ') : b.message;
        errors = b.errors;
      }
    } else {
      const pgCode = (exception as { code?: string })?.code ?? (exception as { cause?: { code?: string } })?.cause?.code;
      const mapped = pgCode ? PG_ERRORS[pgCode] : undefined;
      if (mapped) {
        status = mapped.status;
        title = mapped.title;
        detail = (exception as { cause?: { detail?: string } })?.cause?.detail;
      } else {
        this.logger.error(exception instanceof Error ? exception.stack : String(exception), undefined, `req ${req.id}`);
      }
    }

    reply
      .status(status)
      .header('content-type', 'application/problem+json')
      .send({
        type: 'about:blank',
        title,
        status,
        ...(detail ? { detail } : {}),
        ...(errors ? { errors } : {}),
        instance: req.url,
        requestId: req.id,
      });
  }
}

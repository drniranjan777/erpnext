import type { AppRequest } from './auth-context';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/** Client details recorded on sessions and audit entries. */
export function requestMeta(req: AppRequest): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, requestId: String(req.id) };
}

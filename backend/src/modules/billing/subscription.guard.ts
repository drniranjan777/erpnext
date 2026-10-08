import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../../common/auth-context';
import { EntitlementsService, PlanRequiredException } from './entitlements.service';

const ALLOW_READ_ONLY_KEY = 'allowWhenReadOnly';
/** Mutations on this route/controller stay allowed when the workspace is read-only (billing, account, sign-out...). */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_READ_ONLY_KEY, true);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * After the trial ends (or the subscription lapses / workspace is suspended)
 * the workspace becomes read-only: data stays visible and exportable, but
 * changes are blocked until a plan is chosen.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.auth || SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY_KEY, [context.getHandler(), context.getClass()])) return true;
    const e = await this.entitlements.get(req.auth.tenantId);
    if (!e.readOnly) return true;
    throw new PlanRequiredException(
      e.state === 'suspended'
        ? 'This workspace is suspended. Contact support to restore access.'
        : 'Your trial or subscription has ended, so the workspace is read-only. Choose a plan to continue making changes.',
    );
  }
}

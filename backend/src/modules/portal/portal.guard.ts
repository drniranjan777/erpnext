import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AppRequest } from '../../common/auth-context';
import { PortalAuthService, type PortalIdentity } from './portal-auth.service';

type PortalRequest = AppRequest & { portal?: PortalIdentity };

/** Portal routes are @Public() for the staff guard and checked here against portal sessions instead. */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly auth: PortalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PortalRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Please sign in to the portal');
    const who = await this.auth.identify(token);
    if (!who) throw new UnauthorizedException('Your portal session has ended. Please sign in again.');
    req.portal = who;
    return true;
  }
}

export const Portal = createParamDecorator((_: unknown, ctx: ExecutionContext): PortalIdentity => {
  const p = ctx.switchToHttp().getRequest<PortalRequest>().portal;
  if (!p) throw new UnauthorizedException();
  return p;
});

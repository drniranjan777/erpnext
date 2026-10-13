import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { MODULES, moduleOfPath } from '@nextgen/database';
import type { AppRequest } from '../../common/auth-context';
import { EntitlementsService } from './entitlements.service';

/**
 * Blocks the API of an optional module the workspace has switched off, so hiding a module
 * in the menu is not the only thing keeping it out of reach. Core routes pass untouched.
 */
@Injectable()
export class ModulesGuard implements CanActivate {
  constructor(private readonly entitlements: EntitlementsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) return true;
    const path = req.url.split('?')[0].replace(/^\/api\/v\d+\//, '');
    const key = moduleOfPath(path);
    if (!key) return true;
    const e = await this.entitlements.get(req.auth.tenantId);
    if (e.modules.includes(key)) return true;
    throw new ForbiddenException(`${MODULES[key].label} is switched off for this workspace. An administrator can switch it on under Settings, Modules.`);
  }
}

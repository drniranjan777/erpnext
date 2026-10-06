import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { PermissionCode } from '@nextgen/database';
import { z } from 'zod';
import type { AppRequest, AuthContext } from './auth-context';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips AuthGuard (login, signup, health...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Caller must hold ALL listed permissions in the active tenant. */
export const RequirePermissions = (...codes: PermissionCode[]) => SetMetadata(PERMISSIONS_KEY, codes);

/** Injects the authenticated caller's context. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new UnauthorizedException();
  return req.auth;
});

/** Documents a Zod schema as the request body in Swagger. */
export const ApiZodBody = (schema: z.ZodType) =>
  applyDecorators(ApiBody({ schema: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown> }));

/** Documents each field of a Zod object schema as a query parameter in Swagger. */
export const ApiZodQuery = (schema: z.ZodObject) =>
  applyDecorators(
    ...Object.keys(schema.shape).map((name) => ApiQuery({ name, required: false })),
  );

import { ALL_PERMISSIONS, type PermissionCode } from '@nextgen/database';
import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const roleIds = z.array(z.uuid()).min(1, 'Select at least one role').max(20);

const permissionCodes = z
  .array(z.string())
  .max(500)
  .refine((codes) => codes.every((c) => (ALL_PERMISSIONS as string[]).includes(c)), 'Unknown permission code')
  .transform((codes) => [...new Set(codes)] as PermissionCode[]);

export const idParamSchema = z.object({ id: z.uuid() });

// ---- Users ----------------------------------------------------------------
export const updateMemberSchema = z
  .object({
    status: z.enum(['active', 'disabled']).optional(),
    roleIds: roleIds.optional(),
  })
  .refine((v) => v.status !== undefined || v.roleIds !== undefined, 'Nothing to update');
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

// ---- Invitations ----------------------------------------------------------
export const createInvitationSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(100).optional().or(z.literal('').transform(() => undefined)),
  roleIds,
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const invitationTokenSchema = z.object({ token: z.string().min(20).max(100) });

/** New users must set a name + password; existing users only confirm their password. */
export const acceptInvitationSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  password: z.string().min(1).max(128),
  /** Required when the existing account has two-step verification on. */
  mfaCode: z.string().trim().min(6).max(20).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

// ---- Roles ----------------------------------------------------------------
export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().or(z.literal('').transform(() => undefined)),
  permissions: permissionCodes,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema.partial();
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

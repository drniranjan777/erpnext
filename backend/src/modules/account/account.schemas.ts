import { z } from 'zod';
import { passwordSchema } from '../iam/iam.schemas';

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    mobile: z
      .string()
      .trim()
      .regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
  })
  .refine((v) => v.fullName !== undefined || v.mobile !== undefined, 'Nothing to update');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

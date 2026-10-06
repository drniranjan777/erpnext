import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and parses input with a Zod schema.
 * Usage: `@Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompanyInput`
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      });
    }
    return result.data;
  }
}

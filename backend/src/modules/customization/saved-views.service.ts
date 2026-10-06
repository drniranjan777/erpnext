import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { savedViews, users } from '@nextgen/database';
import { and, asc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';

export const savedViewSchema = z.object({
  entity: z.string().trim().min(2).max(60),
  name: z.string().trim().min(1).max(60),
  filters: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).refine((f) => Object.keys(f).length <= 20, 'Too many filters'),
  isShared: z.boolean().default(false),
});
export type SavedViewInput = z.infer<typeof savedViewSchema>;

/** Saved list filters. Personal by default; shared views are visible to everyone in the workspace. */
@Injectable()
export class SavedViewsService {
  constructor(private readonly database: DatabaseService) {}

  list(auth: AuthContext, entity: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: savedViews.id,
          name: savedViews.name,
          filters: savedViews.filters,
          isShared: savedViews.isShared,
          mine: eq(savedViews.userId, auth.userId),
          owner: users.fullName,
        })
        .from(savedViews)
        .leftJoin(users, eq(users.id, savedViews.userId))
        .where(and(eq(savedViews.entity, entity), or(eq(savedViews.userId, auth.userId), eq(savedViews.isShared, true))))
        .orderBy(asc(savedViews.name)),
    );
  }

  create(auth: AuthContext, input: SavedViewInput) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx
        .insert(savedViews)
        .values({ ...input, tenantId: auth.tenantId, userId: auth.userId })
        .returning({ id: savedViews.id, name: savedViews.name, filters: savedViews.filters, isShared: savedViews.isShared });
      return { ...row, mine: true };
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx.select({ userId: savedViews.userId }).from(savedViews).where(eq(savedViews.id, id));
      if (!row) throw new NotFoundException('View not found');
      if (row.userId !== auth.userId) throw new ForbiddenException('Only the person who created a view can delete it');
      await tx.delete(savedViews).where(eq(savedViews.id, id));
    });
  }
}

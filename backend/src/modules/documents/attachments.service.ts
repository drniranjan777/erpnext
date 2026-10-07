import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { attachments, users } from '@nextgen/database';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ENTITY = 'document';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  list(auth: AuthContext, documentId: string) {
    return this.database.run(auth, async (tx) => {
      await this.documents.getForReader(tx, auth, documentId);
      return tx
        .select({
          id: attachments.id,
          fileName: attachments.fileName,
          contentType: attachments.contentType,
          sizeBytes: attachments.sizeBytes,
          createdAt: attachments.createdAt,
          uploadedBy: { id: attachments.uploadedBy, name: users.fullName },
        })
        .from(attachments)
        .leftJoin(users, eq(users.id, attachments.uploadedBy))
        .where(and(eq(attachments.entityType, ENTITY), eq(attachments.entityId, documentId), isNull(attachments.deletedAt)))
        .orderBy(asc(attachments.createdAt));
    });
  }

  async upload(auth: AuthContext, documentId: string, file: { filename: string; mimetype: string; file: Readable }, meta: RequestMeta) {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      file.file.resume();
      throw new UnsupportedMediaTypeException('Allowed files: PDF, images, Excel, Word, CSV and text');
    }
    const fileName = sanitizeFileName(file.filename);
    if (!fileName) throw new BadRequestException('File name is missing');

    // Check access and storage quota before accepting bytes.
    await this.database.run(auth, async (tx) => {
      await this.documents.getForReader(tx, auth, documentId);
      await this.entitlements.assertLimit(tx, auth.tenantId, 'storageMb', 1);
    });
    const stored = await this.storage.put(auth.tenantId, file.file, MAX_ATTACHMENT_BYTES);

    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.getForReader(tx, auth, documentId);
      const [row] = await tx
        .insert(attachments)
        .values({
          tenantId: auth.tenantId,
          entityType: ENTITY,
          entityId: doc.id,
          fileName,
          contentType: file.mimetype,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          storageKey: stored.key,
          uploadedBy: auth.userId,
        })
        .returning({ id: attachments.id, fileName: attachments.fileName, sizeBytes: attachments.sizeBytes });
      await this.documents.activity(tx, auth, doc.id, 'attachment', `Attached ${fileName}`, { attachmentId: row.id });
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'document.attachment.added',
        entityType: doc.docType,
        entityId: doc.id,
        metadata: { attachmentId: row.id, fileName, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
        ...meta,
      });
      return row;
    });
  }

  async download(auth: AuthContext, attachmentId: string) {
    const row = await this.database.run(auth, async (tx) => {
      const [a] = await tx
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)));
      if (!a) throw new NotFoundException('Attachment not found');
      // Files of other entities (employees…) are served by their own, permission-checked endpoints.
      if (a.entityType !== ENTITY) throw new NotFoundException('Attachment not found');
      await this.documents.getForReader(tx, auth, a.entityId);
      return a;
    });
    return { stream: await this.storage.open(row.storageKey), fileName: row.fileName, contentType: row.contentType, sizeBytes: row.sizeBytes };
  }

  /** Soft delete (the file is kept for audit). Only the uploader can remove a file. */
  async remove(auth: AuthContext, attachmentId: string, meta: RequestMeta) {
    await this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(attachments).where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)));
      if (!a) throw new NotFoundException('Attachment not found');
      if (a.uploadedBy !== auth.userId) throw new ForbiddenException('Only the person who uploaded a file can remove it');
      const doc = await this.documents.getForReader(tx, auth, a.entityId);
      if (doc.status === 'cancelled' || doc.status === 'completed') throw new ForbiddenException('Files on closed documents are kept for the record');
      await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, a.id));
      await this.documents.activity(tx, auth, doc.id, 'attachment', `Removed ${a.fileName}`, { attachmentId: a.id });
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'document.attachment.removed',
        entityType: doc.docType,
        entityId: doc.id,
        metadata: { attachmentId: a.id, fileName: a.fileName },
        ...meta,
      });
    });
  }
}

/** Strips paths and control characters; keeps Unicode (Hindi file names etc.). */
function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 200);
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dmsFiles, dmsFolders, dmsSignatures, dmsVersions, type Transaction } from '@nextgen/database';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../documents/storage.service';
import { ESignService } from '../gmp/esign.service';
import { disposalProblem, extractText, retentionUntil } from './plm-rules';
import { SandboxSigner, UnconfiguredSigner, type SigningProvider } from './signing';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const MAX_FILE = 25 * 1_048_576;

export const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.uuid().nullable().optional(), retentionYears: z.number().int().min(0).max(100).nullable().optional() });
export const fileSchema = z.object({ folderId: z.uuid(), title: z.string().trim().min(2).max(200), docNo: z.string().trim().max(60).nullable().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]) });
export const searchSchema = z.object({ q: z.string().trim().max(200).optional(), folderId: z.uuid().optional(), tag: z.string().trim().max(40).optional() });
export const holdSchema = z.object({ legalHold: z.boolean() });
export const signSchema = z.object({ provider: z.enum(['sandbox', 'aadhaar_esign', 'dsc']).default('sandbox'), password: z.string().min(1).max(200), reason: z.string().trim().max(300).nullable().optional() });

/**
 * Document management: folders with retention, files with versions, full-text search over the text
 * of each current version (plain text and PDFs; scanned images need an OCR provider), legal hold and
 * disposal after retention, and digital signatures through a signing provider.
 */
@Injectable()
export class DocStoreService {
  private readonly providers: Record<string, SigningProvider>;

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly esign: ESignService,
    config: ConfigService<Env, true>,
  ) {
    const secret = Buffer.from(config.get('DATA_ENCRYPTION_KEY', { infer: true }), 'base64');
    this.providers = { sandbox: new SandboxSigner(secret), aadhaar_esign: new UnconfiguredSigner('aadhaar_esign'), dsc: new UnconfiguredSigner('dsc') };
  }

  folders(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select f.id, f.name, f.parent_id as "parentId", f.retention_years as "retentionYears", (select count(*)::int from dms_files x where x.folder_id = f.id and x.status = 'active') as files from dms_folders f order by f.name`),
    );
  }

  createFolder(auth: AuthContext, input: z.infer<typeof folderSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: dmsFolders.id }).from(dmsFolders).where(and(eq(dmsFolders.name, input.name), input.parentId ? eq(dmsFolders.parentId, input.parentId) : isNull(dmsFolders.parentId)));
      if (dup) throw new ConflictException('A folder with this name exists here');
      const [r] = await tx
        .insert(dmsFolders)
        .values({ tenantId: auth.tenantId, name: input.name, parentId: input.parentId ?? null, retentionYears: input.retentionYears ?? null })
        .returning();
      return r;
    });
  }

  /** Files by folder or tag, or matching a full-text search ranked by relevance with a highlighted snippet. */
  search(auth: AuthContext, q: z.infer<typeof searchSchema>) {
    return this.database.run(auth, (tx) => {
      const doc = sql`to_tsvector('simple', f.title || ' ' || coalesce(f.doc_no, '') || ' ' || array_to_string(f.tags, ' ') || ' ' || coalesce(f.content, ''))`;
      const query = q.q ? sql`websearch_to_tsquery('simple', ${q.q})` : null;
      return many(
        tx,
        sql`select f.id, f.title, f.doc_no as "docNo", f.tags, f.current_version as "currentVersion", f.legal_hold as "legalHold", f.retention_until::text as "retentionUntil", f.status, d.name as folder, f.created_at as "createdAt",
                   ${query ? sql`ts_rank(${doc}, ${query})` : sql`0`} as rank,
                   ${query ? sql`ts_headline('simple', coalesce(f.content, f.title), ${query}, 'MaxWords=24, MinWords=8, StartSel=«, StopSel=»')` : sql`null`} as snippet
            from dms_files f join dms_folders d on d.id = f.folder_id
            where f.status = 'active' ${q.folderId ? sql`and f.folder_id = ${q.folderId}` : sql``} ${q.tag ? sql`and ${q.tag} = any(f.tags)` : sql``} ${query ? sql`and ${doc} @@ ${query}` : sql``}
            order by ${query ? sql`rank desc,` : sql``} f.created_at desc limit 100`,
      );
    });
  }

  createFile(auth: AuthContext, input: z.infer<typeof fileSchema>) {
    return this.database.run(auth, async (tx) => {
      const [folder] = await tx.select().from(dmsFolders).where(eq(dmsFolders.id, input.folderId));
      if (!folder) throw new NotFoundException('Folder not found');
      const [r] = await tx
        .insert(dmsFiles)
        .values({ tenantId: auth.tenantId, ...input, docNo: input.docNo ?? null, retentionUntil: retentionUntil(todayIST(), folder.retentionYears), createdBy: auth.userId })
        .returning({ id: dmsFiles.id });
      return this.view(tx, r.id);
    });
  }

  private async view(tx: Transaction, id: string) {
    const [f] = await tx.select().from(dmsFiles).where(eq(dmsFiles.id, id));
    if (!f) throw new NotFoundException('File not found');
    const versions = await many<{ id: string; version: number; fileName: string; contentType: string; sizeBytes: number; sha256: string; note: string | null; textExtracted: boolean; uploadedBy: string | null; createdAt: string; available: boolean }>(
      tx,
      sql`select v.id, v.version, v.file_name as "fileName", v.content_type as "contentType", v.size_bytes as "sizeBytes", v.sha256, v.note, v.text_extracted as "textExtracted", u.full_name as "uploadedBy", v.created_at as "createdAt", v.storage_key is not null as available
          from dms_versions v left join users u on u.id = v.uploaded_by where v.file_id = ${id} order by v.version desc`,
    );
    const sigs = versions.length
      ? await many<{ id: string; versionId: string; provider: string; signerName: string; reason: string | null; sha256: string; signedAt: string }>(tx, sql`select id, version_id as "versionId", provider, signer_name as "signerName", reason, sha256, signed_at as "signedAt" from dms_signatures where version_id in ${versions.map((v) => v.id)} order by signed_at`)
      : [];
    const [folder] = await many<{ name: string }>(tx, sql`select name from dms_folders where id = ${f.folderId}`);
    const { content, ...rest } = f;
    return { ...rest, folder: folder?.name ?? null, hasText: !!content, versions: versions.map((v) => ({ ...v, signatures: sigs.filter((s) => s.versionId === v.id) })), disposal: disposalProblem(f, todayIST()) };
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, id));
  }

  /** Add a version: stored, hashed, and its text kept for search. */
  async addVersion(auth: AuthContext, id: string, file: { filename: string; mimetype: string; file: Readable }, note: string | null) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const ch of file.file) {
      size += (ch as Buffer).length;
      if (size > MAX_FILE) throw new BadRequestException('Files are limited to 25 MB');
      chunks.push(ch as Buffer);
    }
    const buf = Buffer.concat(chunks);
    const text = extractText(file.filename, file.mimetype, buf);
    return this.database.run(auth, async (tx) => {
      const [f] = await tx.select().from(dmsFiles).where(eq(dmsFiles.id, id));
      if (!f) throw new NotFoundException('File not found');
      if (f.status !== 'active') throw new ConflictException('The file was disposed of');
      const stored = await this.storage.put(auth.tenantId, Readable.from(buf), MAX_FILE);
      const version = f.currentVersion + 1;
      await tx.insert(dmsVersions).values({ tenantId: auth.tenantId, fileId: id, version, fileName: file.filename, contentType: file.mimetype || 'application/octet-stream', sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.key, note, textExtracted: text !== null, uploadedBy: auth.userId });
      await tx.update(dmsFiles).set({ currentVersion: version, content: text }).where(eq(dmsFiles.id, id));
      return this.view(tx, id);
    });
  }

  async download(auth: AuthContext, versionId: string) {
    const [v] = await this.database.run(auth, (tx) => tx.select().from(dmsVersions).where(eq(dmsVersions.id, versionId)));
    if (!v) throw new NotFoundException('Version not found');
    if (!v.storageKey) throw new ConflictException('The file was disposed of');
    return { stream: await this.storage.open(v.storageKey), fileName: v.fileName, contentType: v.contentType, sizeBytes: v.sizeBytes };
  }

  hold(auth: AuthContext, id: string, input: z.infer<typeof holdSchema>) {
    return this.database.run(auth, async (tx) => {
      await tx.update(dmsFiles).set({ legalHold: input.legalHold }).where(eq(dmsFiles.id, id));
      return this.view(tx, id);
    });
  }

  /** Files past retention and not on hold. */
  disposalDue(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select f.id, f.title, d.name as folder, f.retention_until::text as "retentionUntil" from dms_files f join dms_folders d on d.id = f.folder_id where f.status = 'active' and not f.legal_hold and f.retention_until <= ${todayIST()}::date order by f.retention_until`),
    );
  }

  /** Dispose of a file after its retention: the stored content goes, the record and hashes stay. */
  dispose(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [f] = await tx.select().from(dmsFiles).where(eq(dmsFiles.id, id));
      if (!f) throw new NotFoundException('File not found');
      const problem = disposalProblem(f, todayIST());
      if (problem) throw new ConflictException(problem);
      await tx.update(dmsVersions).set({ storageKey: null }).where(eq(dmsVersions.fileId, id));
      await tx.update(dmsFiles).set({ status: 'disposed', content: null, disposedAt: new Date() }).where(eq(dmsFiles.id, id));
      return this.view(tx, id);
    });
  }

  /** Sign the current version: the signer confirms with their password, then the provider signs the file hash. */
  sign(auth: AuthContext, versionId: string, input: z.infer<typeof signSchema>, meta: RequestMeta) {
    const provider = this.providers[input.provider];
    if (!provider.configured) throw new ConflictException(`${input.provider === 'dsc' ? 'DSC' : 'Aadhaar eSign'} is not set up for this workspace; use the sandbox signer`);
    return this.database.run(auth, async (tx) => {
      const [v] = await tx.select().from(dmsVersions).where(eq(dmsVersions.id, versionId));
      if (!v) throw new NotFoundException('Version not found');
      const [f] = await tx.select().from(dmsFiles).where(eq(dmsFiles.id, v.fileId));
      if (f.currentVersion !== v.version) throw new ConflictException('Sign the current version');
      const e = await this.esign.sign(tx, auth, { entityType: 'dms_version', entityId: v.id, meaning: `Signed ${f.title} version ${v.version}`, reason: input.reason ?? null, payload: { sha256: v.sha256 }, password: input.password, ip: meta.ip });
      const signedAt = new Date().toISOString();
      const s = provider.sign({ tenantId: auth.tenantId, sha256: v.sha256, signerId: auth.userId, signerName: e.signedBy, signedAt });
      await tx.insert(dmsSignatures).values({ tenantId: auth.tenantId, versionId, provider: provider.id, signerId: auth.userId, signerName: e.signedBy, reason: input.reason ?? null, sha256: v.sha256, certificate: s.certificate, signature: s.signature, signedAt: new Date(signedAt) });
      return this.view(tx, f.id);
    });
  }

  /** Check every signature on a version against the stored file. */
  verify(auth: AuthContext, versionId: string) {
    return this.database.run(auth, async (tx) => {
      const [v] = await tx.select().from(dmsVersions).where(eq(dmsVersions.id, versionId));
      if (!v) throw new NotFoundException('Version not found');
      const sigs = await tx.select().from(dmsSignatures).where(eq(dmsSignatures.versionId, versionId)).orderBy(desc(dmsSignatures.signedAt));
      return sigs.map((s) => ({
        id: s.id,
        signerName: s.signerName,
        provider: s.provider,
        signedAt: s.signedAt,
        hashMatches: s.sha256 === v.sha256,
        valid: s.sha256 === v.sha256 && this.providers[s.provider].verify({ tenantId: auth.tenantId, sha256: s.sha256, signerId: s.signerId ?? '', signedAt: s.signedAt.toISOString(), signature: s.signature }),
      }));
    });
  }
}

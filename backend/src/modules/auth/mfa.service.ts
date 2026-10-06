import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { users } from '@nextgen/database';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import type { RequestMeta } from '../../common/request-meta';
import { generateRecoveryCodes, generateSecret, otpauthUrl, verifyTotp } from '../../common/totp';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const hashCode = (code: string) => createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

/** TOTP two-step verification (authenticator apps) with single-use recovery codes. */
@Injectable()
export class MfaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  status(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.select({ enabled: users.mfaEnabled, codes: users.mfaRecoveryCodes }).from(users).where(eq(users.id, auth.userId));
      return { enabled: !!u?.enabled, recoveryCodesRemaining: u?.enabled ? (u.codes?.length ?? 0) : 0 };
    });
  }

  /** Starts enrolment: stores a new (inactive) secret and returns it for the authenticator app. */
  setup(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.select({ email: users.email, enabled: users.mfaEnabled }).from(users).where(eq(users.id, auth.userId));
      if (u.enabled) throw new ConflictException('Two-step verification is already on. Turn it off first to re-enrol.');
      const secret = generateSecret();
      await tx.update(users).set({ mfaSecret: this.crypto.encrypt(secret), mfaRecoveryCodes: null, mfaLastStep: null }).where(eq(users.id, auth.userId));
      const url = otpauthUrl(secret, u.email);
      return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauthUrl: url, qrCode: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
    });
  }

  /** Confirms enrolment with a code from the app; returns recovery codes (shown once). */
  enable(auth: AuthContext, code: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.select({ secret: users.mfaSecret, enabled: users.mfaEnabled }).from(users).where(eq(users.id, auth.userId));
      if (u.enabled) throw new ConflictException('Two-step verification is already on');
      if (!u.secret) throw new BadRequestException('Start setup first');
      const step = verifyTotp(this.crypto.decrypt(u.secret), code);
      if (step === null) throw new BadRequestException({ message: 'That code is not valid. Check your phone’s time and try the latest code.', errors: [{ path: 'code', message: 'Invalid code' }] });
      const codes = generateRecoveryCodes();
      await tx.update(users).set({ mfaEnabled: true, mfaLastStep: step, mfaRecoveryCodes: codes.map(hashCode) }).where(eq(users.id, auth.userId));
      await this.securityEvent(tx, auth, 'turned on', 'account.mfa.enabled', meta);
      return { enabled: true, recoveryCodes: codes };
    });
  }

  disable(auth: AuthContext, password: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      await this.assertPassword(tx, auth.userId, password);
      await tx.update(users).set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null, mfaLastStep: null }).where(eq(users.id, auth.userId));
      await this.securityEvent(tx, auth, 'turned off', 'account.mfa.disabled', meta);
      return { enabled: false };
    });
  }

  regenerateRecoveryCodes(auth: AuthContext, password: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      await this.assertPassword(tx, auth.userId, password);
      const [u] = await tx.select({ enabled: users.mfaEnabled }).from(users).where(eq(users.id, auth.userId));
      if (!u.enabled) throw new ConflictException('Two-step verification is off');
      const codes = generateRecoveryCodes();
      await tx.update(users).set({ mfaRecoveryCodes: codes.map(hashCode) }).where(eq(users.id, auth.userId));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'account.mfa.recovery_codes_regenerated', entityType: 'user', entityId: auth.userId, ...meta });
      return { recoveryCodes: codes };
    });
  }

  /**
   * Checks a login challenge: a current TOTP code (not reused) or an unused
   * recovery code (consumed). Runs as the user (RLS self-access).
   */
  verifyChallenge(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    return this.database.run({ userId }, async (tx) => {
      const [u] = await tx
        .select({ secret: users.mfaSecret, codes: users.mfaRecoveryCodes, lastStep: users.mfaLastStep, enabled: users.mfaEnabled })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!u?.enabled || !u.secret) return null;
      const step = verifyTotp(this.crypto.decrypt(u.secret), code, { notAfterStep: u.lastStep });
      if (step !== null) {
        await tx.update(users).set({ mfaLastStep: step }).where(eq(users.id, userId));
        return 'totp';
      }
      const hashed = hashCode(code);
      if (u.codes?.includes(hashed)) {
        await tx.update(users).set({ mfaRecoveryCodes: u.codes.filter((c) => c !== hashed) }).where(eq(users.id, userId));
        return 'recovery';
      }
      return null;
    });
  }

  private async assertPassword(tx: Parameters<Parameters<DatabaseService['run']>[1]>[0], userId: string, password: string) {
    const [u] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!(await verify(u.hash, password).catch(() => false))) {
      throw new BadRequestException({ message: 'Password is incorrect', errors: [{ path: 'password', message: 'Password is incorrect' }] });
    }
  }

  private async securityEvent(tx: Parameters<Parameters<DatabaseService['run']>[1]>[0], auth: AuthContext, action: string, auditAction: string, meta: RequestMeta) {
    await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: auditAction, entityType: 'user', entityId: auth.userId, ...meta });
    await this.notifications.notify(tx, auth.tenantId, 'account.mfa_changed', [{ userId: auth.userId }], {
      action,
      when: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      ip: meta.ip ?? 'unknown',
    });
  }
}

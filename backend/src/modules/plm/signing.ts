import { createHmac, timingSafeEqual } from 'node:crypto';

/** A digital signing service: the local sandbox here; Aadhaar eSign (ESP) and DSC tokens plug in behind the same interface. */
export interface SigningProvider {
  readonly id: 'sandbox' | 'aadhaar_esign' | 'dsc';
  readonly configured: boolean;
  sign(input: { tenantId: string; sha256: string; signerId: string; signerName: string; signedAt: string }): { signature: string; certificate: Record<string, string> };
  verify(input: { tenantId: string; sha256: string; signerId: string; signedAt: string; signature: string }): boolean;
}

/**
 * Sandbox signer: an HMAC-SHA256 over the document hash, signer and time, with a key derived per
 * workspace from the data-encryption key. Good for flows and tamper checks; not a legal signature.
 */
export class SandboxSigner implements SigningProvider {
  readonly id = 'sandbox' as const;
  readonly configured = true;
  constructor(private readonly secret: Buffer) {}

  private key(tenantId: string) {
    return createHmac('sha256', this.secret).update(`dms-sandbox-signing:${tenantId}`).digest();
  }

  private mac(i: { tenantId: string; sha256: string; signerId: string; signedAt: string }) {
    return createHmac('sha256', this.key(i.tenantId)).update(`${i.sha256}|${i.signerId}|${i.signedAt}`).digest('base64');
  }

  sign(i: { tenantId: string; sha256: string; signerId: string; signerName: string; signedAt: string }) {
    return { signature: this.mac(i), certificate: { issuer: 'NextGen ERP sandbox CA', subject: i.signerName, algorithm: 'HMAC-SHA256', validity: 'sandbox only' } };
  }

  verify(i: { tenantId: string; sha256: string; signerId: string; signedAt: string; signature: string }) {
    const a = Buffer.from(this.mac(i));
    const b = Buffer.from(i.signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/** Placeholder for an external provider that has no credentials in this environment. */
export class UnconfiguredSigner implements SigningProvider {
  readonly configured = false;
  constructor(readonly id: 'aadhaar_esign' | 'dsc') {}
  sign(): never {
    throw new Error(`${this.id === 'dsc' ? 'DSC' : 'Aadhaar eSign'} is not set up for this workspace`);
  }
  verify() {
    return false;
  }
}

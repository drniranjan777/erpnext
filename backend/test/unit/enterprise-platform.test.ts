import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { allowedEmail, authorizeUrl, pkce, samlSpMetadata, verifyIdToken } from '../../src/modules/enterprise-platform/oidc';
import { insertionOrder, remap } from '../../src/modules/enterprise-platform/tenant-copy';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(alg: 'RS256' | 'ES256', kid: string, key: Parameters<typeof sign>[2], claims: Record<string, unknown>) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64(claims);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), alg === 'ES256' ? { key: key as never, dsaEncoding: 'ieee-p1363' } : key);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

describe('OIDC', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const keys = [
    { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'r1', alg: 'RS256' },
    { ...ec.publicKey.export({ format: 'jwk' }), kid: 'e1', alg: 'ES256' },
  ];
  const now = 1_790_000_000_000;
  const claims = { iss: 'https://login.example', aud: 'client-1', sub: 'u1', exp: now / 1000 + 300, iat: now / 1000, nonce: 'n1', email: 'asha@acme.in', email_verified: true, name: 'Asha' };
  const expect1 = { issuer: 'https://login.example', clientId: 'client-1', nonce: 'n1', now };

  it('makes PKCE pairs and the authorization URL', () => {
    const p = pkce();
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
    const u = new URL(authorizeUrl({ issuer: 'i', authorization_endpoint: 'https://login.example/authorize', token_endpoint: '', jwks_uri: '' }, { clientId: 'c', redirectUri: 'https://erp/cb', state: 's', nonce: 'n', challenge: p.challenge }));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'c', scope: 'openid email profile', state: 's', nonce: 'n', code_challenge_method: 'S256' });
  });

  it('accepts good RS256 and ES256 tokens and refuses bad ones', () => {
    expect(verifyIdToken(jwt('RS256', 'r1', rsa.privateKey, claims), keys, expect1).email).toBe('asha@acme.in');
    expect(verifyIdToken(jwt('ES256', 'e1', ec.privateKey, claims), keys, expect1).sub).toBe('u1');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => verifyIdToken(jwt('RS256', 'r1', other.privateKey, claims), keys, expect1)).toThrow('signature');
    expect(() => verifyIdToken(jwt('RS256', 'r1', rsa.privateKey, { ...claims, nonce: 'x' }), keys, expect1)).toThrow('nonce');
    expect(() => verifyIdToken(jwt('RS256', 'r1', rsa.privateKey, { ...claims, aud: 'other' }), keys, expect1)).toThrow('another client');
    expect(() => verifyIdToken(jwt('RS256', 'r1', rsa.privateKey, { ...claims, exp: now / 1000 - 3600 }), keys, expect1)).toThrow('expired');
    expect(() => verifyIdToken(jwt('RS256', 'zz', rsa.privateKey, claims), keys, expect1)).toThrow('No signing key');
  });

  it('checks the email and makes SAML metadata', () => {
    expect(allowedEmail({ ...claims, email: 'Asha@ACME.in' } as never, ['acme.in'])).toEqual({ email: 'asha@acme.in', problem: null });
    expect(allowedEmail({ ...claims, email: 'x@gmail.com' } as never, ['acme.in']).problem).toContain('gmail.com is not allowed');
    expect(allowedEmail({ ...claims, email_verified: false } as never, []).problem).toContain('not verified');
    expect(samlSpMetadata('https://erp/sso/acme', 'https://erp/acs')).toContain('Location="https://erp/acs"');
  });
});

describe('workspace copy', () => {
  it('orders tables parents first and defers cyclic references', () => {
    const fks = [
      { table: 'lines', columns: ['doc_id'], refTable: 'docs', nullable: false },
      { table: 'docs', columns: ['company_id'], refTable: 'companies', nullable: false },
      { table: 'accounts', columns: ['parent_id'], refTable: 'accounts', nullable: true },
      { table: 'accounts', columns: ['company_id'], refTable: 'companies', nullable: false },
      { table: 'companies', columns: ['main_account_id'], refTable: 'accounts', nullable: true },
      { table: 'docs', columns: ['created_by'], refTable: 'users', nullable: true },
    ];
    const { order, deferred } = insertionOrder(['lines', 'docs', 'companies', 'accounts'], fks);
    expect(order.indexOf('companies')).toBeLessThan(order.indexOf('docs'));
    expect(order.indexOf('docs')).toBeLessThan(order.indexOf('lines'));
    expect(deferred.map((d) => `${d.table}.${d.columns}`).sort()).toEqual(['accounts.parent_id', 'companies.main_account_id']);
  });

  it('re-keys ids anywhere in a row', () => {
    const ids = new Map([['a', 'A'], ['t', 'T']]);
    expect(remap({ id: 'a', tenant_id: 't', note: 'b', refs: ['a', 'c'], data: { members: [{ companyId: 'a' }] }, n: 3 }, ids)).toEqual({ id: 'A', tenant_id: 'T', note: 'b', refs: ['A', 'c'], data: { members: [{ companyId: 'A' }] }, n: 3 });
  });
});

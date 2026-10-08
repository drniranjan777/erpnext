import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

/**
 * OpenID Connect pieces for the authorization-code flow with PKCE: the request URL, and checking the
 * ID token's RS256 / ES256 signature against the provider's keys and its claims.
 */

const b64url = (b: Buffer) => b.toString('base64url');

export function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export function authorizeUrl(d: Discovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; loginHint?: string | null }) {
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (p.loginHint) u.searchParams.set('login_hint', p.loginHint);
  return u.toString();
}

export interface IdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
}

const ALGS: Record<string, string> = { RS256: 'sha256', ES256: 'sha256', RS384: 'sha384', RS512: 'sha512' };

/** Checks the signature with the matching JWK and the claims; returns the claims or throws with the reason. */
export function verifyIdToken(token: string, keys: (JsonWebKey & { kid?: string; alg?: string })[], expect: { issuer: string; clientId: string; nonce: string; now?: number; leewaySec?: number }): IdClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg: string; kid?: string };
  const hash = ALGS[header.alg];
  if (!hash) throw new Error(`ID token algorithm ${header.alg} is not accepted`);
  const jwk = keys.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.alg || k.alg === header.alg));
  if (!jwk) throw new Error('No signing key matches the ID token');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = verify(hash, Buffer.from(`${parts[0]}.${parts[1]}`), header.alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('ID token signature is not valid');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as IdClaims;
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  const leeway = expect.leewaySec ?? 60;
  if (c.iss !== expect.issuer) throw new Error('ID token is from another issuer');
  if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(expect.clientId)) throw new Error('ID token is for another client');
  if (typeof c.exp !== 'number' || c.exp + leeway < now) throw new Error('ID token has expired');
  if (c.iat && c.iat - leeway > now) throw new Error('ID token is issued in the future');
  if (c.nonce !== expect.nonce) throw new Error('ID token nonce does not match');
  return c;
}

/** The email in the token, if verified and in an allowed domain. */
export function allowedEmail(c: IdClaims, domains: string[]) {
  const email = (c.email ?? c.preferred_username ?? '').toLowerCase();
  if (!email.includes('@')) return { email: null, problem: 'The identity provider did not send an email address' };
  if (c.email_verified === false || c.email_verified === 'false') return { email: null, problem: 'The email address is not verified at the identity provider' };
  const domain = email.split('@')[1];
  if (domains.length && !domains.map((d) => d.toLowerCase()).includes(domain)) return { email: null, problem: `${domain} is not allowed to sign in to this workspace` };
  return { email, problem: null };
}

/** SAML 2.0 service provider metadata for the identity provider's setup. */
export function samlSpMetadata(entityId: string, acsUrl: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
`;
}

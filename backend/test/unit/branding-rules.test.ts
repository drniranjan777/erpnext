import { describe, expect, it } from 'vitest';
import { colourProblem, contrast, domainProblem, emailDomain, logoProblem, senderIdProblem, txtMatches } from '../../src/modules/whitelabel/branding-rules';

const svg = (s: string) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;

describe('branding rules', () => {
  it('checks colour contrast against white text', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#1d4ed8', '#ffffff')).toBeGreaterThan(4.5);
    expect(colourProblem('#1d4ed8')).toBeNull();
    expect(colourProblem('#ffd400')).toContain('contrast');
    expect(colourProblem('blue')).toBe('Colours are written as #rrggbb');
    expect(colourProblem(null)).toBeNull();
  });

  it('accepts safe logos only', () => {
    expect(logoProblem(svg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'))).toBeNull();
    expect(logoProblem(svg('<svg onload="alert(1)"></svg>'))).toContain('scripts');
    expect(logoProblem(svg('<svg><image href="https://evil.example/x.png"/></svg>'))).toContain('external');
    expect(logoProblem('data:image/gif;base64,R0lGOD')).toContain('PNG, JPEG or SVG');
    expect(logoProblem(`data:image/png;base64,${Buffer.alloc(210 * 1024).toString('base64')}`)).toContain('200 KB');
  });

  it('checks domains, sender IDs and DNS proofs', () => {
    expect(domainProblem('erp.acme.co.in', ['nextgen-erp.in', 'localhost'])).toBeNull();
    expect(domainProblem('acme.nextgen-erp.in', ['nextgen-erp.in'])).toBe('Use your own domain, not ours');
    expect(domainProblem('not a domain', [])).toContain('host name');
    expect([senderIdProblem('ACMEWK'), senderIdProblem('acmewk'), senderIdProblem(null)]).toEqual([null, 'The SMS sender ID (DLT header) is 6 capital letters', null]);
    expect(emailDomain('ERP@Acme.Example')).toBe('acme.example');
    expect(txtMatches([['v=spf1 -all'], ['nextgen-verify=', 'abc123']], 'abc123')).toBe(true);
    expect(txtMatches([['nextgen-verify=other']], 'abc123')).toBe(false);
  });
});

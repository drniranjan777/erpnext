import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cadFormat, cadMetadata, canBuy, canSell, compareBoms, disposalProblem, extractText, gateProblems, nextRevision, pdfText, retentionUntil } from '../../src/modules/plm/plm-rules';
import { SandboxSigner } from '../../src/modules/plm/signing';

describe('lifecycle', () => {
  it('gates moves between stages', () => {
    const ok = { made: true, releasedEbom: true, releasedCad: true, openDemand: 0 };
    expect(gateProblems('prototype', 'released', ok)).toEqual([]);
    expect(gateProblems('prototype', 'released', { ...ok, releasedEbom: false, releasedCad: false })).toEqual(['Release the engineering BOM first', 'Release a CAD file or drawing for the item first']);
    expect(gateProblems('prototype', 'released', { ...ok, made: false, releasedEbom: false })).toEqual([]);
    expect(gateProblems('concept', 'released', ok)[0]).toContain('cannot go from concept to released');
    expect(gateProblems('phase_out', 'obsolete', { ...ok, openDemand: 2 })).toEqual(['2 open order line(s) still use the item']);
    expect([canBuy('phase_out'), canSell('phase_out'), canSell('obsolete'), canBuy('released')]).toEqual([false, true, false, true]);
  });

  it('counts revisions and compares BOMs', () => {
    expect(['A', 'B', 'Z', 'AZ', 'ZZ', '01', '9'].map(nextRevision)).toEqual(['B', 'C', 'AA', 'BA', 'AAA', '02', '10']);
    expect(compareBoms([{ itemId: 'a', qty: 2 }, { itemId: 'b', qty: 1 }, { itemId: 'c', qty: 4 }], [{ itemId: 'a', qty: 2 }, { itemId: 'b', qty: 3 }, { itemId: 'box', qty: 1 }])).toEqual({
      onlyDesign: [{ itemId: 'c', qty: 4 }],
      onlyManufacturing: [{ itemId: 'box', qty: 1 }],
      qtyDiffers: [{ itemId: 'b', design: 1, manufacturing: 3 }],
      matches: false,
    });
  });
});

describe('CAD and text', () => {
  it('reads formats and metadata of text CAD files', () => {
    expect([cadFormat('BRACKET.SLDPRT'), cadFormat('a.stp'), cadFormat('x.zip')]).toEqual(['sldprt', 'step', 'other']);
    expect(cadMetadata('plate.dxf', Buffer.from('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n'))).toEqual({ acadVersion: 'AC1032', units: 'millimetres' });
    expect(cadMetadata('shaft.step', Buffer.from("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Drive shaft'),'2;1');\nFILE_NAME('shaft.step','2026-10-01T10:00:00',('R. Rao'),('NextGen'),'','','');\nFILE_SCHEMA(('AP214'));\nENDSEC;"))).toEqual({ description: 'Drive shaft', modelName: 'shaft.step', exportedAt: '2026-10-01T10:00:00', author: 'R. Rao', schema: 'AP214' });
  });

  it('extracts text from plain and compressed PDFs', () => {
    const content = 'BT /F1 12 Tf 72 712 Td (Hydraulic press) Tj [(main) -250 (tenance)] TJ (SOP \\(rev 3\\)) Tj ET';
    const pdf = (body: Buffer, filter: string) => Buffer.concat([Buffer.from(`%PDF-1.4\n4 0 obj\n<< /Length ${body.length}${filter} >>\nstream\n`), body, Buffer.from('\nendstream\nendobj\n%%EOF')]);
    expect(pdfText(pdf(Buffer.from(content), ''))).toBe('Hydraulic press maintenance SOP (rev 3)');
    expect(pdfText(pdf(deflateSync(Buffer.from(content)), ' /Filter /FlateDecode'))).toBe('Hydraulic press maintenance SOP (rev 3)');
    expect(extractText('notes.txt', 'text/plain', Buffer.from('hello'))).toBe('hello');
    expect(extractText('photo.jpg', 'image/jpeg', Buffer.from([1, 2, 3]))).toBeNull();
  });

  it('keeps retention and legal hold', () => {
    expect(retentionUntil('2026-10-08', 8)).toBe('2034-10-08');
    expect(retentionUntil('2026-10-08', null)).toBeNull();
    expect(disposalProblem({ legalHold: true, retentionUntil: '2020-01-01', status: 'active' }, '2026-10-08')).toBe('The file is under legal hold');
    expect(disposalProblem({ legalHold: false, retentionUntil: '2030-01-01', status: 'active' }, '2026-10-08')).toBe('Keep until 2030-01-01');
    expect(disposalProblem({ legalHold: false, retentionUntil: '2026-10-08', status: 'active' }, '2026-10-08')).toBeNull();
  });

  it('signs and verifies with the sandbox provider', () => {
    const s = new SandboxSigner(Buffer.alloc(32, 7));
    const input = { tenantId: 't1', sha256: 'a'.repeat(64), signerId: 'u1', signerName: 'Asha', signedAt: '2026-10-08T05:00:00.000Z' };
    const sig = s.sign(input);
    expect(s.verify({ ...input, signature: sig.signature })).toBe(true);
    expect(s.verify({ ...input, sha256: 'b'.repeat(64), signature: sig.signature })).toBe(false);
    expect(s.verify({ ...input, tenantId: 't2', signature: sig.signature })).toBe(false);
  });
});

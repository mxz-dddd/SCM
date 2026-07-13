import { describe, expect, it } from 'vitest';
import {
  escapePostscript,
  watermarkImage,
  watermarkText,
} from './watermark.service';

describe('sensitive attachment watermarking', () => {
  it('adds an attributable watermark to text downloads', () => {
    const result = watermarkText(
      Buffer.from('shipment facts'),
      'account-1 · trace-1',
    ).toString('utf8');
    expect(result).toContain('WATERMARK: account-1 · trace-1');
    expect(result).toContain('shipment facts');
  });

  it('wraps images in a watermarked SVG without losing source bytes', () => {
    const source = Buffer.from([1, 2, 3, 4]);
    const result = watermarkImage(
      source,
      'image/png',
      'account-1 <trace>',
    ).toString('utf8');
    expect(result).toContain(source.toString('base64'));
    expect(result).toContain('account-1 &lt;trace&gt;');
  });

  it('escapes generated PostScript instead of interpolating commands', () => {
    expect(escapePostscript('user (ops) \\ trace')).toBe(
      'user \\(ops\\) \\\\ trace',
    );
  });
});

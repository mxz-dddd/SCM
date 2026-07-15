import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';

const execute = promisify(execFile);

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function escapePostscript(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

export function watermarkText(source: Buffer, watermark: string): Buffer {
  return Buffer.concat([
    Buffer.from(`WATERMARK: ${watermark}\n\n`, 'utf8'),
    source,
  ]);
}

export function watermarkImage(
  source: Buffer,
  contentType: string,
  watermark: string,
): Buffer {
  const encoded = source.toString('base64');
  const label = xmlEscape(watermark);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1200 900">` +
      `<image width="1200" height="900" preserveAspectRatio="xMidYMid meet" href="data:${xmlEscape(contentType)};base64,${encoded}"/>` +
      `<g fill="#8c8c8c" fill-opacity="0.28" font-family="sans-serif" font-size="34" transform="rotate(-24 600 450)">` +
      [180, 400, 620, 840, 1060]
        .map((x) => `<text x="${x - 300}" y="450">${label}</text>`)
        .join('') +
      `</g></svg>`,
    'utf8',
  );
}

@Injectable()
export class WatermarkService {
  async apply(
    source: Buffer,
    contentType: string,
    watermark: string,
  ): Promise<{ readonly body: Buffer; readonly contentType: string }> {
    if (contentType.startsWith('text/') || contentType === 'application/json') {
      return { body: watermarkText(source, watermark), contentType };
    }
    if (contentType.startsWith('image/')) {
      return {
        body: watermarkImage(source, contentType, watermark),
        contentType: 'image/svg+xml',
      };
    }
    if (contentType === 'application/pdf') {
      return {
        body: await this.watermarkPdf(source, watermark),
        contentType,
      };
    }
    throw new AppError(
      'ATTACHMENT_WATERMARK_TYPE_UNSUPPORTED',
      'Sensitive attachments must use a watermark-capable content type',
      409,
    );
  }

  private async watermarkPdf(source: Buffer, watermark: string) {
    const directory = await mkdtemp(join(tmpdir(), 'scm-watermark-'));
    const input = join(directory, 'input.pdf');
    const output = join(directory, 'output.pdf');
    const overlay = join(directory, 'overlay.ps');
    const postscript = `<< /EndPage { 2 eq { pop false } { gsave /Helvetica-Bold findfont 18 scalefont setfont 0.78 setgray 30 rotate 120 220 moveto (${escapePostscript(watermark)}) show grestore true } ifelse } >> setpagedevice`;
    try {
      await Promise.all([
        writeFile(input, source),
        writeFile(overlay, postscript, 'utf8'),
      ]);
      await execute(process.env.GHOSTSCRIPT_PATH ?? 'gs', [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        '-sDEVICE=pdfwrite',
        `-sOutputFile=${output}`,
        overlay,
        input,
      ]);
      return await readFile(output);
    } catch {
      throw new AppError(
        'ATTACHMENT_WATERMARK_ENGINE_UNAVAILABLE',
        'PDF watermark processing is temporarily unavailable',
        503,
        { retryable: true },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

import { inflateRawSync } from 'node:zlib';
import { AppError } from '../../common/app-error';

export interface TabularData {
  readonly headers: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) {
    throw new AppError(
      'IMPORT_CSV_INVALID',
      'CSV contains an unclosed quote',
      400,
    );
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((cell) => cell.length));
}

function toTabular(rows: readonly (readonly string[])[]): TabularData {
  const headers = (rows[0] ?? []).map((header) => header.trim());
  if (
    headers.length === 0 ||
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length
  ) {
    throw new AppError(
      'IMPORT_HEADERS_INVALID',
      'Import headers must be non-empty and unique',
      400,
    );
  }
  return {
    headers,
    rows: rows
      .slice(1)
      .map((values) =>
        Object.fromEntries(
          headers.map((header, index) => [header, values[index] ?? '']),
        ),
      ),
  };
}

export function parseCsv(source: Buffer): TabularData {
  if (source.byteLength > 25 * 1024 * 1024) {
    throw new AppError(
      'IMPORT_FILE_TOO_LARGE',
      'Import file is too large',
      400,
    );
  }
  return toTabular(
    parseCsvRows(source.toString('utf8').replace(/^\uFEFF/, '')),
  );
}

function findEndOfCentralDirectory(source: Buffer): number {
  const minimum = Math.max(0, source.length - 65_557);
  for (let index = source.length - 22; index >= minimum; index -= 1) {
    if (source.readUInt32LE(index) === 0x06054b50) return index;
  }
  throw new AppError(
    'IMPORT_XLSX_INVALID',
    'XLSX ZIP directory is missing',
    400,
  );
}

function unzip(source: Buffer): ReadonlyMap<string, Buffer> {
  const end = findEndOfCentralDirectory(source);
  const entryCount = source.readUInt16LE(end + 10);
  const centralOffset = source.readUInt32LE(end + 16);
  if (entryCount > 100 || centralOffset >= source.length) {
    throw new AppError(
      'IMPORT_XLSX_INVALID',
      'XLSX archive limits exceeded',
      400,
    );
  }
  const entries = new Map<string, Buffer>();
  let offset = centralOffset;
  let expandedBytes = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (source.readUInt32LE(offset) !== 0x02014b50) {
      throw new AppError(
        'IMPORT_XLSX_INVALID',
        'XLSX ZIP entry is invalid',
        400,
      );
    }
    const flags = source.readUInt16LE(offset + 8);
    const method = source.readUInt16LE(offset + 10);
    const compressedSize = source.readUInt32LE(offset + 20);
    const uncompressedSize = source.readUInt32LE(offset + 24);
    const nameLength = source.readUInt16LE(offset + 28);
    const extraLength = source.readUInt16LE(offset + 30);
    const commentLength = source.readUInt16LE(offset + 32);
    const localOffset = source.readUInt32LE(offset + 42);
    const name = source
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    if (flags & 1 || ![0, 8].includes(method) || name.includes('..')) {
      throw new AppError(
        'IMPORT_XLSX_INVALID',
        'XLSX ZIP entry is unsupported',
        400,
      );
    }
    if (source.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new AppError(
        'IMPORT_XLSX_INVALID',
        'XLSX local ZIP entry is invalid',
        400,
      );
    }
    const localNameLength = source.readUInt16LE(localOffset + 26);
    const localExtraLength = source.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = source.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : inflateRawSync(compressed);
    expandedBytes += content.length;
    if (
      content.length !== uncompressedSize ||
      expandedBytes > 25 * 1024 * 1024
    ) {
      throw new AppError(
        'IMPORT_XLSX_INVALID',
        'XLSX expanded size is invalid',
        400,
      );
    }
    entries.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? '';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

export function parseXlsx(source: Buffer): TabularData {
  if (source.byteLength > 25 * 1024 * 1024) {
    throw new AppError(
      'IMPORT_FILE_TOO_LARGE',
      'Import file is too large',
      400,
    );
  }
  const entries = unzip(source);
  const sheet = entries.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (!sheet) {
    throw new AppError(
      'IMPORT_XLSX_INVALID',
      'First XLSX worksheet is missing',
      400,
    );
  }
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(
    (match) =>
      xmlText(
        [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((text) => text[1]!)
          .join(''),
      ),
  );
  const rows = [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(
    (rowMatch) => {
      const values: string[] = [];
      for (const cell of rowMatch[1]!.matchAll(
        /<c\b([^>]*)>([\s\S]*?)<\/c>/g,
      )) {
        const attributes = cell[1]!;
        const body = cell[2]!;
        const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? 'A1';
        const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        const inline = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
        const value =
          type === 's' ? (shared[Number(raw)] ?? '') : xmlText(inline ?? raw);
        values[columnIndex(reference)] = value;
      }
      return values;
    },
  );
  return toTabular(rows);
}

export function parseTabularFile(
  source: Buffer,
  format: 'CSV' | 'XLSX',
): TabularData {
  return format === 'CSV' ? parseCsv(source) : parseXlsx(source);
}

import { describe, expect, it } from 'vitest';
import { parseCsv, parseXlsx } from './tabular-file';

function storedZip(entries: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const [nameValue, contentValue] of Object.entries(entries)) {
    const name = Buffer.from(nameValue);
    const content = Buffer.from(contentValue);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + content.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('restricted CSV and XLSX import parsing', () => {
  it('parses UTF-8 CSV including escaped quotes and embedded newlines', () => {
    expect(
      parseCsv(
        Buffer.from(
          '\uFEFFbusinessRef,status,summary\r\nA-1,READY,"line 1\nline ""2"""',
        ),
      ),
    ).toEqual({
      headers: ['businessRef', 'status', 'summary'],
      rows: [
        { businessRef: 'A-1', status: 'READY', summary: 'line 1\nline "2"' },
      ],
    });
  });

  it('parses the first XLSX worksheet without adding a runtime dependency', () => {
    const source = storedZip({
      'xl/sharedStrings.xml':
        '<sst><si><t>businessRef</t></si><si><t>status</t></si><si><t>SO-1</t></si><si><t>READY</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>',
    });
    expect(parseXlsx(source)).toEqual({
      headers: ['businessRef', 'status'],
      rows: [{ businessRef: 'SO-1', status: 'READY' }],
    });
  });

  it('rejects duplicate headers and malformed archives', () => {
    expect(() => parseCsv(Buffer.from('id,id\n1,2'))).toThrow(/unique/);
    expect(() => parseXlsx(Buffer.from('not-a-zip'))).toThrow();
  });
});

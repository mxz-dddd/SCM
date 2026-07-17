import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modulesRoot = resolve(process.cwd(), 'src/modules');
const repositoryRoot = resolve(process.cwd(), '../..');

const filesUnder = (root: string): string[] =>
  readdirSync(root).flatMap((name) => {
    const target = join(root, name);
    return statSync(target).isDirectory() ? filesUnder(target) : [target];
  });

describe('business number generation static gate', () => {
  it('does not compose business number fields from timestamps or UUID fragments', () => {
    const violations: string[] = [];
    for (const file of filesUnder(modulesRoot).filter(
      (candidate) =>
        candidate.endsWith('.service.ts') && !candidate.includes('.test.'),
    )) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const assignment of line.matchAll(
          /\b(?:[A-Za-z]\w*No|businessNo|code|lpn)\s*:\s*([^,}\n]+)/g,
        )) {
          const expression = assignment[1]!;
          if (
            /Date\.now\s*\(|randomUUID\s*\(|\.slice\s*\(\s*0\s*,/.test(
              expression,
            ) ||
            /^`[A-Z][A-Z0-9_-]*[-:]/.test(expression)
          )
            violations.push(`${relative(repositoryRoot, file)}:${index + 1}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('seeds every literal business type used by the numbering facade helper', () => {
    const used = new Set<string>();
    for (const file of filesUnder(modulesRoot).filter((candidate) =>
      candidate.endsWith('.service.ts'),
    )) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(
        /businessNumber\([\s\S]{0,240}?['"]([A-Z][A-Z0-9_]+)['"]/g,
      ))
        if (match[1] !== 'PAYABLE') used.add(match[1]!);
    }
    const seed = readFileSync(
      resolve(repositoryRoot, 'apps/api/prisma/seed.ts'),
      'utf8',
    );
    const seeded = new Set(
      [...seed.matchAll(/^ {2}'([A-Z][A-Z0-9_]+)',$/gm)].map(
        (match) => match[1]!,
      ),
    );
    expect(
      [...used].filter((businessType) => !seeded.has(businessType)),
    ).toEqual([]);
  });
});

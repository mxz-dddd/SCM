import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
export const artifactRoot = path.join(
  repositoryRoot,
  '.artifacts/ui-reference',
);

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJson(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

export async function fileMetadata(filePath) {
  const metadata = await stat(filePath);
  return {
    bytes: metadata.size,
    file: path.relative(repositoryRoot, filePath),
  };
}

export function parseArguments(argv) {
  return Object.fromEntries(
    argv.slice(2).map((argument) => {
      const [key, ...value] = argument.replace(/^--/, '').split('=');
      return [key, value.length === 0 ? true : value.join('=')];
    }),
  );
}

export function safeSlug(value) {
  return value
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

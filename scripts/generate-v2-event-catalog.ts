import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  EVENT_SUBSCRIPTIONS,
  subscriptionsForEvent,
} from '../packages/shared/src/events/subscriptions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'apps/api/src');
const output = join(root, 'docs/design/V2_EVENT_CATALOG.md');
const eventNamePattern = /^[a-z][a-z0-9.-]{2,149}\.v\d+$/;
const eventParameterNames = new Set(['event', 'eventName', 'eventType']);

function declarationName(
  node: ts.FunctionDeclaration | ts.MethodDeclaration,
): string | undefined {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function calledName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function staticEvents(expression: ts.Expression): ReadonlySet<string> {
  const events = new Set<string>();
  function collect(node: ts.Node) {
    if (ts.isStringLiteralLike(node) && eventNamePattern.test(node.text)) {
      events.add(node.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(expression);
  return events;
}

function eventsInSource(source: string, file: string): ReadonlySet<string> {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parameterIndexes = new Map<string, Set<number>>();
  const events = new Set<string>();

  function indexDeclarations(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      const name = declarationName(node);
      if (name) {
        node.parameters.forEach((parameter, index) => {
          if (
            ts.isIdentifier(parameter.name) &&
            eventParameterNames.has(parameter.name.text)
          ) {
            const indexes = parameterIndexes.get(name) ?? new Set<number>();
            indexes.add(index);
            parameterIndexes.set(name, indexes);
          }
        });
      }
    }
    ts.forEachChild(node, indexDeclarations);
  }

  function collect(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'eventName') ||
        (ts.isStringLiteralLike(node.name) && node.name.text === 'eventName'))
    ) {
      for (const event of staticEvents(node.initializer)) events.add(event);
    }
    if (ts.isCallExpression(node)) {
      const name = calledName(node.expression);
      const indexes = name ? parameterIndexes.get(name) : undefined;
      if (indexes) {
        for (const index of indexes) {
          const argument = node.arguments[index];
          if (argument) {
            for (const event of staticEvents(argument)) events.add(event);
          }
        }
      } else if (name === 'emit' || name === 'record') {
        for (const argument of node.arguments) {
          for (const event of staticEvents(argument)) events.add(event);
        }
      }
    }
    ts.forEachChild(node, collect);
  }

  indexDeclarations(parsed);
  collect(parsed);
  return events;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() &&
        path.endsWith('.ts') &&
        !path.endsWith('.test.ts')
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

export async function discoverEmittedEvents() {
  const discovered = new Map<string, Set<string>>();
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, 'utf8');
    for (const event of eventsInSource(source, file)) {
      const locations = discovered.get(event) ?? new Set<string>();
      locations.add(relative(root, file));
      discovered.set(event, locations);
    }
  }
  return discovered;
}

function render(discovered: ReadonlyMap<string, ReadonlySet<string>>): string {
  const subscriptions = EVENT_SUBSCRIPTIONS.map(
    (item) =>
      `| \`${item.consumer}\` | \`${item.eventPatterns.join(', ')}\` | \`${item.endpoint}\` | ${item.mode} | ${item.required ? '是' : '否'} | ${item.maxAttempts} | ${item.baseDelaySeconds} |`,
  ).join('\n');
  const events = [...discovered.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([event, files]) => {
      const consumers = subscriptionsForEvent(event)
        .map((item) => item.consumer)
        .join(', ');
      return `| \`${event}\` | ${consumers || '明确无订阅'} | ${[...files]
        .sort()
        .map((file) => `\`${file}\``)
        .join('<br>')} |`;
    })
    .join('\n');
  return `# V2 事件目录与订阅清单

> 本文件由 \`pnpm event:catalog\` 从 API 源码中的 \`eventName\`、\`emit\`、\`record\` 与 Outbox 写入点扫描生成。请勿手工维护事件行。
> V2-08 的真实 Worker E2E 会校验自动 fan-out、EVERY_EVENT 顺序、重试、死信、分区阻塞和人工重放。

## 订阅定义

| Consumer | 事件模式 | 内部端点 | 消费语义 | 必需 | 最大尝试 | 基础退避秒 |
| --- | --- | --- | --- | --- | ---: | ---: |
${subscriptions}

## 代码扫描目录

已发现 ${discovered.size} 个静态事件名。动态事件名仍必须符合 \`{domain}.{event}.v{n}\` 并在代码评审中核对。

| 事件 | 匹配消费者 | 发现位置 |
| --- | --- | --- |
${events}
`;
}

async function generateValidatedEventCatalog() {
  const discovered = await discoverEmittedEvents();
  const unclassified = [...discovered.keys()].filter(
    (event) => subscriptionsForEvent(event).length === 0,
  );
  if (unclassified.length) {
    throw new Error(
      `Emitted events require a subscription or explicit classification: ${unclassified.join(', ')}`,
    );
  }
  return render(discovered);
}

export async function assertGeneratedEventCatalog() {
  const generated = await generateValidatedEventCatalog();
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== generated) {
    throw new Error('V2_EVENT_CATALOG.md is stale; run pnpm event:catalog');
  }
}

async function main() {
  if (process.argv.includes('--check')) {
    await assertGeneratedEventCatalog();
    return;
  }
  await writeFile(output, await generateValidatedEventCatalog());
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (entrypoint === import.meta.url) void main();

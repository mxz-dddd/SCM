import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENT_SUBSCRIPTIONS,
  subscriptionsForEvent,
} from '../packages/shared/src/events/subscriptions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'apps/api/src');
const output = join(root, 'docs/design/V2_EVENT_CATALOG.md');
const eventNamePattern = /^[a-z][a-z0-9.-]{2,149}\.v\d+$/;

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
    const candidates = [
      ...source.matchAll(
        /eventName\s*:\s*['"`]([a-z][a-z0-9.-]{2,149}\.v\d+)['"`]/g,
      ),
      ...source.matchAll(
        /(?:this\.)?(?:emit|record)\s*\([\s\S]{0,500}?['"`]([a-z][a-z0-9.-]{2,149}\.v\d+)['"`]/g,
      ),
    ];
    for (const candidate of candidates) {
      const event = candidate[1];
      if (!event || !eventNamePattern.test(event)) continue;
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

async function main() {
  const discovered = await discoverEmittedEvents();
  const unclassified = [...discovered.keys()].filter(
    (event) => subscriptionsForEvent(event).length === 0,
  );
  if (unclassified.length) {
    throw new Error(
      `Emitted events require a subscription or explicit classification: ${unclassified.join(', ')}`,
    );
  }
  const generated = render(discovered);
  if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current !== generated) {
      throw new Error('V2_EVENT_CATALOG.md is stale; run pnpm event:catalog');
    }
  } else {
    await writeFile(output, generated);
  }
}

void main();

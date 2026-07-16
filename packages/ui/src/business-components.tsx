import type { ReactNode } from 'react';
import type { ActionDecision } from './action-registry';

export interface QueryField {
  readonly label: string;
  readonly name: string;
  readonly placeholder?: string;
  readonly quick?: boolean;
  readonly type?: 'date' | 'date-range' | 'search' | 'text';
}

export function serializeQueryToSearchParams(
  values: Readonly<Record<string, string>>,
): string {
  const parameters = new URLSearchParams();
  Object.entries(values)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => parameters.set(key, value));
  return parameters.toString();
}

export function QueryPanel(props: {
  readonly expanded?: boolean;
  readonly fields: readonly QueryField[];
  readonly onQuery: (values: Readonly<Record<string, string>>) => void;
  readonly onReset: () => void;
  readonly onSaveView?: () => void;
}) {
  return (
    <form
      aria-label="查询条件"
      className="scm-query-panel"
      onReset={props.onReset}
      onSubmit={(event) => {
        event.preventDefault();
        const values = Object.fromEntries(
          new FormData(event.currentTarget).entries(),
        );
        props.onQuery(
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, String(value)]),
          ),
        );
      }}
    >
      {props.fields
        .filter((field) => props.expanded || field.quick)
        .map((field) => (
          <label key={field.name}>
            <span>{field.label}</span>
            <input
              name={field.name}
              placeholder={field.placeholder}
              type={field.type === 'date' ? 'date' : 'text'}
            />
          </label>
        ))}
      <button type="submit">查询</button>
      <button type="reset">重置</button>
      {props.onSaveView ? (
        <button onClick={props.onSaveView} type="button">
          保存视图
        </button>
      ) : null}
    </form>
  );
}

export function CommandBar(props: {
  readonly actions: readonly ActionDecision[];
  readonly onAction: (action: ActionDecision) => void;
}) {
  return (
    <div aria-label="命令栏" className="scm-command-bar" role="toolbar">
      {props.actions.map((action) => (
        <button
          disabled={!action.enabled}
          key={action.id}
          onClick={() => props.onAction(action)}
          title={action.reason}
          type="button"
        >
          {action.label}
          {action.asynchronous ? ' · 异步' : ''}
        </button>
      ))}
    </div>
  );
}

interface PageTemplateProps {
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly eyebrow?: string;
  readonly feedback?: ReactNode;
  readonly title: string;
}

function PageTemplate(
  props: PageTemplateProps & {
    readonly variant: 'configuration' | 'list' | 'master-detail' | 'task';
  },
) {
  return (
    <section className={`scm-page-template scm-page-template-${props.variant}`}>
      <header className="scm-page-heading">
        {props.eyebrow ? <span>{props.eyebrow}</span> : null}
        <h2>{props.title}</h2>
        {props.description ? <p>{props.description}</p> : null}
      </header>
      {props.feedback ? (
        <div className="scm-page-feedback">{props.feedback}</div>
      ) : null}
      <div className="scm-page-body">{props.children}</div>
    </section>
  );
}

export function ListPageTemplate(props: PageTemplateProps) {
  return <PageTemplate {...props} variant="list" />;
}

export function MasterDetailPageTemplate(props: PageTemplateProps) {
  return <PageTemplate {...props} variant="master-detail" />;
}

export function TaskPageTemplate(props: PageTemplateProps) {
  return <PageTemplate {...props} variant="task" />;
}

export function ConfigurationPageTemplate(props: PageTemplateProps) {
  return <PageTemplate {...props} variant="configuration" />;
}

export interface DataGridColumn<TRow> {
  readonly fixed?: 'left' | 'right';
  readonly key: keyof TRow & string;
  readonly label: string;
  readonly render?: (value: TRow[keyof TRow], row: TRow) => ReactNode;
  readonly visible?: boolean;
}

export function DataGrid<TRow extends { readonly id: string }>(props: {
  readonly columns: readonly DataGridColumn<TRow>[];
  readonly onColumnsChange?: (visibleColumnKeys: readonly string[]) => void;
  readonly onExportView?: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRowContextMenu?: (row: TRow) => void;
  readonly onSelectionChange?: (ids: readonly string[]) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly rows: readonly TRow[];
  readonly selectedIds?: readonly string[];
  readonly total: number;
}) {
  const columns = props.columns.filter((column) => column.visible !== false);
  return (
    <div className="scm-data-grid">
      <table>
        <thead>
          <tr>
            {props.onSelectionChange ? <th>选择</th> : null}
            {columns.map((column) => (
              <th data-fixed={column.fixed} key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={row.id}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onRowContextMenu?.(row);
              }}
            >
              {props.onSelectionChange ? (
                <td>
                  <input
                    aria-label={`选择 ${row.id}`}
                    checked={props.selectedIds?.includes(row.id) ?? false}
                    onChange={(event) => {
                      const selected = new Set(props.selectedIds ?? []);
                      if (event.target.checked) selected.add(row.id);
                      else selected.delete(row.id);
                      props.onSelectionChange?.([...selected]);
                    }}
                    type="checkbox"
                  />
                </td>
              ) : null}
              {columns.map((column) => {
                const value = row[column.key];
                return (
                  <td key={column.key}>
                    {column.render ? column.render(value, row) : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="scm-data-grid-tools">
        {props.onColumnsChange ? (
          <button
            onClick={() =>
              props.onColumnsChange?.(columns.map(({ key }) => key))
            }
            type="button"
          >
            列配置
          </button>
        ) : null}
        {props.onExportView ? (
          <button onClick={props.onExportView} type="button">
            导出当前视图
          </button>
        ) : null}
      </div>
      <nav aria-label="分页">
        <button
          disabled={props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
          type="button"
        >
          上一页
        </button>
        <span>
          {props.page} / {Math.max(1, Math.ceil(props.total / props.pageSize))}
        </span>
        <button
          disabled={props.page * props.pageSize >= props.total}
          onClick={() => props.onPageChange(props.page + 1)}
          type="button"
        >
          下一页
        </button>
      </nav>
    </div>
  );
}

export function MasterDetail(props: {
  readonly currentVersion: number;
  readonly detail: ReactNode;
  readonly list: ReactNode;
  readonly onSave: (version: number) => void;
  readonly versionConflict?: {
    readonly actual: number;
    readonly expected: number;
  };
}) {
  return (
    <div className="scm-master-detail">
      <div>{props.list}</div>
      <aside>
        {props.versionConflict ? (
          <div role="alert">
            版本冲突：期望 {props.versionConflict.expected}，当前{' '}
            {props.versionConflict.actual}
          </div>
        ) : null}
        {props.detail}
        <button
          onClick={() => props.onSave(props.currentVersion)}
          type="button"
        >
          保存
        </button>
      </aside>
    </div>
  );
}

const STATUS_TONES = {
  danger: new Set(['FAILED', 'REJECTED', 'CANCELLED']),
  success: new Set(['ACTIVE', 'COMPLETED', 'APPROVED']),
  warning: new Set(['PENDING', 'SUSPENDED', 'EXCEPTION']),
};

export function StatusBadge(props: { readonly status: string }) {
  const tone = Object.entries(STATUS_TONES).find(([, statuses]) =>
    statuses.has(props.status),
  )?.[0];
  return (
    <span className={`scm-status scm-status-${tone ?? 'neutral'}`}>
      {props.status}
    </span>
  );
}

export function StatusStepper(props: {
  readonly current: string;
  readonly errorStatuses?: readonly string[];
  readonly unreachableStatuses?: readonly string[];
  readonly statuses: readonly string[];
}) {
  const currentIndex = props.statuses.indexOf(props.current);
  return (
    <ol className="scm-status-stepper">
      {props.statuses.map((status, index) => (
        <li
          data-state={
            props.errorStatuses?.includes(status)
              ? 'error'
              : props.unreachableStatuses?.includes(status)
                ? 'unreachable'
                : index < currentIndex
                  ? 'completed'
                  : index === currentIndex
                    ? 'current'
                    : 'pending'
          }
          key={status}
        >
          {status}
        </li>
      ))}
    </ol>
  );
}

export interface TimelineEvent {
  readonly actor: string;
  readonly occurredAt: string;
  readonly source: string;
  readonly title: string;
  readonly traceId: string;
}

export function BusinessTimeline(props: {
  readonly events: readonly TimelineEvent[];
  readonly source?: string;
}) {
  return (
    <ol className="scm-timeline">
      {props.events
        .filter((event) => !props.source || event.source === props.source)
        .map((event) => (
          <li key={`${event.traceId}:${event.occurredAt}`}>
            <time>{event.occurredAt}</time> {event.title} · {event.source} ·{' '}
            {event.actor} · <code>{event.traceId}</code>
          </li>
        ))}
    </ol>
  );
}

export function TaskWorkbench(props: {
  readonly activeTaskId?: string;
  readonly onClaim: (taskId: string) => void;
  readonly tasks: readonly {
    readonly id: string;
    readonly priority: number;
    readonly title: string;
  }[];
}) {
  return (
    <section className="scm-task-workbench">
      <ul>
        {[...props.tasks]
          .sort((a, b) => b.priority - a.priority)
          .map((task) => (
            <li data-active={task.id === props.activeTaskId} key={task.id}>
              {task.title}
              <button onClick={() => props.onClaim(task.id)} type="button">
                领取
              </button>
            </li>
          ))}
      </ul>
      <label>
        扫码
        <input autoComplete="off" inputMode="none" />
      </label>
    </section>
  );
}

export function BusinessDrawer(props: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
}) {
  return props.open ? (
    <aside aria-label={props.title} className="scm-drawer">
      <button onClick={props.onClose} type="button">
        关闭
      </button>
      {props.children}
    </aside>
  ) : null;
}

export function DecisionModal(props: {
  readonly children: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly open: boolean;
  readonly title: string;
}) {
  return props.open ? (
    <div aria-modal="true" role="dialog">
      <h2>{props.title}</h2>
      {props.children}
      <button onClick={props.onCancel} type="button">
        取消
      </button>
      <button onClick={props.onConfirm} type="button">
        确认
      </button>
    </div>
  ) : null;
}

export interface NotificationItem {
  readonly id: string;
  readonly message: string;
  readonly severity: 'error' | 'info' | 'success' | 'warning';
  readonly traceId?: string;
}

export function NotificationCenter(props: {
  readonly items: readonly NotificationItem[];
}) {
  return (
    <ul aria-label="消息中心">
      {props.items.map((item) => (
        <li data-severity={item.severity} key={item.id}>
          {item.message} {item.traceId ? <code>{item.traceId}</code> : null}
        </li>
      ))}
    </ul>
  );
}

export function ToastFeedback(props: {
  readonly message: string;
  readonly tone: 'error' | 'success';
}) {
  return (
    <div aria-live="polite" className={`scm-toast scm-toast-${props.tone}`}>
      {props.message}
    </div>
  );
}

export interface FieldUpdateResult {
  readonly failures: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  readonly updatedIds: readonly string[];
}

export function applyFieldUpdate<TRow extends { readonly id: string }>(input: {
  readonly allowedFields: ReadonlySet<keyof TRow & string>;
  readonly field: keyof TRow & string;
  readonly rows: readonly TRow[];
  readonly value: unknown;
  readonly validate: (
    row: TRow,
    field: keyof TRow & string,
    value: unknown,
  ) =>
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: string };
}): FieldUpdateResult {
  if (!input.allowedFields.has(input.field) || input.field === 'status') {
    return {
      failures: input.rows.map(({ id }) => ({
        id,
        reason: 'FIELD_UPDATE_NOT_ALLOWED',
      })),
      updatedIds: [],
    };
  }
  const failures: { id: string; reason: string }[] = [];
  const updatedIds: string[] = [];
  for (const row of input.rows) {
    const decision = input.validate(row, input.field, input.value);
    if (decision.allowed) updatedIds.push(row.id);
    else failures.push({ id: row.id, reason: decision.reason });
  }
  return { failures, updatedIds };
}

export function FieldUpdater(props: {
  readonly allowedFields: readonly string[];
  readonly impactCount: number;
  readonly onApply: (field: string, value: string) => void;
}) {
  return (
    <form
      aria-label="批量字段更新"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        props.onApply(String(data.get('field')), String(data.get('value')));
      }}
    >
      <strong>影响 {props.impactCount} 条</strong>
      <select name="field">
        {props.allowedFields.map((field) => (
          <option key={field} value={field}>
            {field}
          </option>
        ))}
      </select>
      <input name="value" />
      <button type="submit">应用</button>
    </form>
  );
}

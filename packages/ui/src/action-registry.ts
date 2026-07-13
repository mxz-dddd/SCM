export interface ActionDefinition<TStatus extends string = string> {
  readonly allowedStatuses?: readonly TStatus[];
  readonly asynchronous?: boolean;
  readonly confirmMessage?: string;
  readonly id: string;
  readonly label: string;
  readonly requiredPermissions: readonly string[];
}

export interface ActionContext<TStatus extends string = string> {
  readonly dataScopeAllowed: boolean;
  readonly permissions: ReadonlySet<string>;
  readonly status: TStatus;
}

export interface ActionDecision {
  readonly asynchronous: boolean;
  readonly confirmMessage?: string;
  readonly enabled: boolean;
  readonly id: string;
  readonly label: string;
  readonly reason?: 'DATA_SCOPE_DENIED' | 'PERMISSION_DENIED' | 'STATUS_DENIED';
}

export function resolveAction<TStatus extends string>(
  definition: ActionDefinition<TStatus>,
  context: ActionContext<TStatus>,
): ActionDecision {
  const base = {
    asynchronous: definition.asynchronous ?? false,
    ...(definition.confirmMessage
      ? { confirmMessage: definition.confirmMessage }
      : {}),
    id: definition.id,
    label: definition.label,
  };
  if (
    !definition.requiredPermissions.every((permission) =>
      context.permissions.has(permission),
    )
  ) {
    return { ...base, enabled: false, reason: 'PERMISSION_DENIED' };
  }
  if (!context.dataScopeAllowed) {
    return { ...base, enabled: false, reason: 'DATA_SCOPE_DENIED' };
  }
  if (
    definition.allowedStatuses &&
    !definition.allowedStatuses.includes(context.status)
  ) {
    return { ...base, enabled: false, reason: 'STATUS_DENIED' };
  }
  return { ...base, enabled: true };
}

export function createActionRegistry<TStatus extends string>(
  definitions: readonly ActionDefinition<TStatus>[],
) {
  const byId = new Map<string, ActionDefinition<TStatus>>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(`Duplicate action id: ${definition.id}`);
    }
    byId.set(definition.id, definition);
  }
  return {
    decide: (id: string, context: ActionContext<TStatus>) => {
      const definition = byId.get(id);
      if (!definition) throw new Error(`Unknown action id: ${id}`);
      return resolveAction(definition, context);
    },
    list: () => [...byId.values()],
  };
}

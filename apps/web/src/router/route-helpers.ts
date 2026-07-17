import type { WorkspaceTab } from '@scm/shared';
import {
  ADMIN_ROUTE_REGISTRY,
  type AppRouteDefinition,
} from './route-registry';

export function routeToWorkspaceTab(route: AppRouteDefinition): WorkspaceTab {
  return { dirty: false, id: route.id, route: route.path, title: route.title };
}

export function findAdminRouteById(id: string): AppRouteDefinition | undefined {
  return ADMIN_ROUTE_REGISTRY.find((route) => route.id === id);
}

export function findAdminRouteByPath(
  pathname: string,
): AppRouteDefinition | undefined {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return ADMIN_ROUTE_REGISTRY.find((route) => route.path === normalized);
}

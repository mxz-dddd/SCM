import { createElement } from 'react';
import {
  Navigate,
  createBrowserRouter,
  type RouteObject,
} from 'react-router-dom';
import { useSessionStore } from '../platform/session-store';
import { ApplicationShell } from '../workspace/ApplicationShell';
import {
  ADMIN_ROUTE_REGISTRY,
  TERMINAL_ROUTE_REGISTRY,
  type AppRouteDefinition,
} from './route-registry';
import {
  NotFoundPage,
  RouteErrorPage,
  RouteLoading,
  UnauthorizedPage,
  WorkbenchHome,
} from './route-support';

function lazyRoute(definition: AppRouteDefinition) {
  return async () => {
    const Page = await definition.load();
    function RegisteredPage() {
      const claims = useSessionStore((state) => state.claims);
      if (
        claims &&
        definition.allowedAccountKinds &&
        !definition.allowedAccountKinds.includes(claims.accountKind)
      ) {
        return createElement(UnauthorizedPage);
      }
      return createElement(Page);
    }
    return { Component: RegisteredPage };
  };
}

export function createAppRouteObjects(): RouteObject[] {
  return [
    {
      path: '/',
      Component: ApplicationShell,
      errorElement: createElement(RouteErrorPage),
      children: [
        {
          index: true,
          element: createElement(Navigate, { replace: true, to: '/workbench' }),
        },
        {
          path: 'tms/shipments',
          element: createElement(Navigate, {
            replace: true,
            to: '/tms/orders',
          }),
        },
        {
          path: 'wms/operations',
          element: createElement(Navigate, {
            replace: true,
            to: '/wms/operations/tasks',
          }),
        },
        {
          path: 'mdm/warehouses',
          element: createElement(Navigate, {
            replace: true,
            to: '/mdm/capacity',
          }),
        },
        {
          path: 'mdm/governance',
          element: createElement(Navigate, {
            replace: true,
            to: '/mdm/charges',
          }),
        },
        ...ADMIN_ROUTE_REGISTRY.map((definition) =>
          definition.id === 'workbench'
            ? {
                path: definition.path.slice(1),
                element: createElement(WorkbenchHome),
                errorElement: createElement(RouteErrorPage),
              }
            : {
                path: definition.path.slice(1),
                lazy: lazyRoute(definition),
                HydrateFallback: RouteLoading,
                errorElement: createElement(RouteErrorPage),
              },
        ),
      ],
    },
    {
      path: '/mobile/portal',
      element: createElement(Navigate, {
        replace: true,
        to: '/integration/mobile-portal',
      }),
    },
    ...TERMINAL_ROUTE_REGISTRY.map((definition) => ({
      path: definition.path,
      lazy: lazyRoute(definition),
      HydrateFallback: RouteLoading,
      errorElement: createElement(RouteErrorPage),
    })),
    { path: '*', element: createElement(NotFoundPage) },
  ];
}

export function createAppRouter() {
  return createBrowserRouter(createAppRouteObjects());
}

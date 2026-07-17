import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { SessionClaims } from '@scm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RouterProvider,
  createMemoryRouter,
  matchRoutes,
} from 'react-router-dom';
import { useSessionStore } from '../platform/session-store';
import { useWorkspaceStore } from '../workspace/workspace-store';
import {
  ADMIN_NAV_CATEGORIES,
  ADMIN_ROUTE_REGISTRY,
  APP_ROUTE_REGISTRY,
} from './route-registry';
import { createAppRouteObjects } from './app-router';

const userClaims: SessionClaims = {
  accountKind: 'USER',
  deviceId: 'web-test',
  expiresAt: Date.now() + 60_000,
  issuedAt: Date.now(),
  organizationIds: [],
  permissionVersion: 1,
  subject: '10000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000002',
  tokenId: 'router-test-token',
};

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  useSessionStore.setState({ accessToken: undefined, claims: undefined });
  useWorkspaceStore.setState({
    activeTabId: 'workbench',
    context: { language: 'zh-CN', tenantId: 'unselected' },
    tabs: [
      { dirty: false, id: 'workbench', route: '/workbench', title: '工作台' },
      {
        dirty: false,
        id: 'identity',
        route: '/platform/identity',
        title: '租户与认证',
      },
    ],
  });
});

describe('application route registry', () => {
  it('assigns every admin route to exactly one category and business group', () => {
    const assignments = ADMIN_NAV_CATEGORIES.flatMap((category) =>
      category.groups.flatMap((group) =>
        group.routeIds.map((routeId) => ({
          categoryId: category.id,
          groupId: group.id,
          routeId,
        })),
      ),
    );
    expect(
      ADMIN_NAV_CATEGORIES.every((category) => category.groups.length > 0),
    ).toBe(true);
    expect(
      ADMIN_NAV_CATEGORIES.every((category) =>
        category.groups.every((group) => group.routeIds.length > 0),
      ),
    ).toBe(true);
    expect(assignments).toHaveLength(ADMIN_ROUTE_REGISTRY.length);
    expect(new Set(assignments.map(({ routeId }) => routeId)).size).toBe(
      ADMIN_ROUTE_REGISTRY.length,
    );
    expect(assignments.map(({ routeId }) => routeId).sort()).toEqual(
      ADMIN_ROUTE_REGISTRY.map(({ id }) => id).sort(),
    );
  });

  it('matches and lazy-loads every registered primary route', async () => {
    const routeObjects = createAppRouteObjects();
    expect(new Set(APP_ROUTE_REGISTRY.map(({ id }) => id)).size).toBe(
      APP_ROUTE_REGISTRY.length,
    );
    for (const definition of APP_ROUTE_REGISTRY) {
      const pathname = definition.path.replace(/\/\*$/, '');
      expect(matchRoutes(routeObjects, pathname), pathname).not.toBeNull();
    }
    const pages = await Promise.all(
      APP_ROUTE_REGISTRY.map((definition) => definition.load()),
    );
    expect(pages.every((page) => typeof page === 'function')).toBe(true);
  });

  it('keeps the five audited long-tail families on explicit stable routes', () => {
    const registeredPaths = new Set(
      ADMIN_ROUTE_REGISTRY.map(({ path }) => path),
    );
    const expectedFamilies = {
      warehouse: [
        '/wms/operations/tasks',
        '/wms/operations/wes',
        '/wms/operations/performance',
        '/wms/operations/rules',
        '/wms/operations/devices',
      ],
      masterData: [
        '/mdm/products',
        '/mdm/partners',
        '/mdm/regions',
        '/mdm/capacity',
        '/mdm/fleet',
        '/mdm/charges',
        '/mdm/organizations',
        '/mdm/attachments',
        '/mdm/settings',
      ],
      reports: [
        '/reports/center',
        '/reports/subjects',
        '/reports/mine',
        '/reports/templates',
      ],
      support: [
        '/support/help',
        '/support/user-guide',
        '/support/operations',
        '/support/api',
        '/support/releases',
      ],
      dataScreens: [
        '/screens/manage',
        '/screens/groups',
        '/screens/mine',
        '/screens/maps',
      ],
    };

    for (const [family, paths] of Object.entries(expectedFamilies)) {
      expect(
        paths.every((path) => registeredPaths.has(path)),
        `${family} route coverage`,
      ).toBe(true);
    }
  });

  it('opens an admin deep link and synchronizes history with workspace tabs', async () => {
    const router = createMemoryRouter(createAppRouteObjects(), {
      initialEntries: ['/workbench'],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: '平台与系统' }));
    await screen.findByRole('region', { name: '平台与系统分层导航' });
    fireEvent.click(screen.getByRole('button', { name: '体验与配置' }));
    await screen.findByRole('heading', { name: '统一业务组件' });
    expect(router.state.location.pathname).toBe('/platform/components');

    fireEvent.click(screen.getByRole('button', { name: '配置中心' }));
    await screen.findByRole('heading', { name: '配置、字典与单号中心' });
    expect(router.state.location.pathname).toBe('/platform/configuration');

    await act(() => router.navigate(-1));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/platform/components'),
    );
    expect(screen.getByRole('button', { name: '统一组件' })).toHaveClass(
      'active',
    );

    fireEvent.click(screen.getByRole('tab', { name: '配置中心' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/platform/configuration'),
    );
  });

  it('returns a stable 403 for a route outside the signed-in account kind', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline test'));
    useSessionStore.setState({ accessToken: 'test-token', claims: userClaims });
    const router = createMemoryRouter(createAppRouteObjects(), {
      initialEntries: ['/platform/operations'],
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('403 · 无权访问')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '生产运维' }),
    ).not.toBeInTheDocument();
  });

  it('renders independent customer, partner, driver and RF terminal routes', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
    window.dispatchEvent(new Event('resize'));
    for (const [path, title] of [
      ['/portal/customer', '客户门户'],
      ['/portal/partner', '伙伴门户'],
      ['/driver', '司机执行端'],
      ['/rf', '仓储 RF 端'],
    ] as const) {
      const router = createMemoryRouter(createAppRouteObjects(), {
        initialEntries: [path],
      });
      const view = render(<RouterProvider router={router} />);
      expect(
        await screen.findByRole('heading', { name: title }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('navigation', { name: `${title}底部导航` }),
      ).toBeInTheDocument();
      view.unmount();
    }
  });

  it('keeps the old portal link as a real URL redirect', async () => {
    const router = createMemoryRouter(createAppRouteObjects(), {
      initialEntries: ['/mobile/portal'],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/integration/mobile-portal'),
    );
    expect(
      await screen.findByRole('heading', { name: '客户移动端与合作伙伴门户' }),
    ).toBeInTheDocument();
  });

  it('keeps the old transport workbench URL as a real redirect', async () => {
    const router = createMemoryRouter(createAppRouteObjects(), {
      initialEntries: ['/tms/shipments'],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/tms/orders'),
    );
  });

  it('keeps every admin path addressable without hash routing', () => {
    expect(ADMIN_ROUTE_REGISTRY.every(({ path }) => path.startsWith('/'))).toBe(
      true,
    );
    expect(ADMIN_ROUTE_REGISTRY.some(({ path }) => path.includes('#'))).toBe(
      false,
    );
  });
});

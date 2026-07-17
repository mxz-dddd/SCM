import { expect, test, type Page } from '@playwright/test';

const categories = [
  '工作台',
  '订单管理',
  '仓储管理',
  '运输管理',
  '预约管理',
  '结算管理',
  '主数据',
  '控制塔与分析',
  '协同与集成',
  '平台与系统',
] as const;

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }
      input, textarea, .ant-table-tbody td, .ant-statistic-content-value, time,
      [data-sensitive], [data-business-ref], [class*="amount"], [class*="address"] {
        color: transparent !important;
        text-shadow: 0 0 8px rgba(80, 91, 105, .65) !important;
      }
    `,
  });
  await page
    .locator('.ant-spin-spinning, [aria-busy="true"]')
    .first()
    .waitFor({
      state: 'hidden',
      timeout: 3_000,
    })
    .catch(() => undefined);
  await expect(page.locator('body')).toBeVisible();
}

test('application shell and ten primary categories are visually stable', async ({
  page,
}) => {
  await page.goto('/workbench');
  await stabilize(page);
  await expect(page).toHaveScreenshot('application-shell.png', {
    fullPage: false,
  });

  const moduleNavigation = page.getByRole('navigation', { name: '模块导航' });
  for (const [index, category] of categories.entries()) {
    const button = moduleNavigation.getByRole('button', {
      name: category,
      exact: true,
    });
    await expect(button).toHaveCount(1);
    await button.click();
    await expect(
      page.getByRole('region', { name: `${category}分层导航` }),
    ).toBeVisible();
    await stabilize(page);
    await expect(page).toHaveScreenshot(
      `primary-${String(index + 1).padStart(2, '0')}.png`,
      { fullPage: false },
    );
  }
});

test('representative list, secondary navigation, drawer and modal are stable', async ({
  page,
}) => {
  await page.goto('/wms/inbounds');
  await stabilize(page);
  await expect(
    page.getByRole('navigation', { name: '业务分组' }),
  ).toBeVisible();
  await expect(page.getByRole('form', { name: '查询条件' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page).toHaveScreenshot('representative-list.png', {
    fullPage: false,
  });

  await page.goto('/workbench');
  await stabilize(page);
  await page.getByRole('button', { name: '收藏与最近' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveScreenshot('workspace-drawer.png', {
    fullPage: false,
  });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '⌘K 命令' }).click();
  await expect(
    page.getByRole('dialog', { name: '全局命令面板' }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot('command-modal.png', { fullPage: false });
});

test('four transport pages retain distinct stable routes and selected tabs', async ({
  page,
}) => {
  const routes = [
    ['/tms/orders', '订单', 'tms-orders.png'],
    ['/tms/planning', '计划', 'tms-planning.png'],
    ['/tms/execution', '执行', 'tms-execution.png'],
    ['/tms/settlement', '结算与分析', 'tms-settlement.png'],
  ] as const;
  for (const [route, tabName, screenshot] of routes) {
    await page.goto(route);
    await stabilize(page);
    await expect(
      page.getByRole('tab', { name: tabName, exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveScreenshot(screenshot, { fullPage: false });
  }
});

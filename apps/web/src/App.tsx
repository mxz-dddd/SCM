import { useEffect, useState } from 'react';
import { applyScmCssVariables, scmAntdTheme } from '@scm/ui/tokens';
import { ConfigProvider } from 'antd';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from './router/app-router';

export function App() {
  const [router] = useState(createAppRouter);
  useEffect(() => applyScmCssVariables(document.documentElement), []);
  return (
    <ConfigProvider theme={scmAntdTheme}>
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}

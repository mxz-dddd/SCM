import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the application shell and opens workspace tools', () => {
    render(<App />);

    expect(
      screen.getByRole('navigation', { name: '模块导航' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '租户' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '组织' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '仓库' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '⌘K 命令' }));
    expect(
      screen.getByRole('dialog', { name: '全局命令面板' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('搜索命令')).toBeInTheDocument();
  });

  it('opens the shared business component gallery', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '组件' }));

    expect(
      screen.getByRole('heading', { name: '统一业务组件' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '命令栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByText(/版本冲突/)).toBeInTheDocument();
  });
});

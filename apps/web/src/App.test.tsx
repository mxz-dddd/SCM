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

  it('opens the configuration, dictionary and number rule workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '配置' }));

    expect(
      screen.getByRole('heading', { name: '配置、字典与单号中心' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByText('分层配置版本')).toBeInTheDocument();
    expect(screen.getByText('业务字典与原因码')).toBeInTheDocument();
    expect(screen.getByText('单号与号段')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建配置草稿' })).toBeDisabled();
  });

  it('opens the read-only audit and change history workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '审计' }));

    expect(
      screen.getByRole('heading', { name: '审计与变更历史' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByText('不可变 ChangeHistory')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '导出当前审计视图' }),
    ).toBeDisabled();
  });

  it('opens the presigned upload and watermarked download workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '附件' }));

    expect(
      screen.getByRole('heading', { name: '附件与对象存储' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByText('上传并关联业务对象')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择并上传' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '授权下载' })).toBeDisabled();
  });

  it('opens the unified inbox and notification delivery workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '消息' }));

    expect(
      screen.getByRole('heading', { name: '待办与消息中心' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByText('订阅与免打扰')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标记已读' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '投递 / 重试' })).toBeDisabled();
  });

  it('opens import, export, search and saved views', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '数据' }));

    expect(
      screen.getByRole('heading', { name: '导入导出与统一搜索' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByText('导入预检与逐行回执')).toBeInTheDocument();
    expect(screen.getByText('异步脱敏导出与限时下载')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建导入预检/ })).toBeDisabled();
  });

  it('opens versioned workflows and the unified approval center', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '审批' }));

    expect(
      screen.getByRole('heading', { name: '工作流与统一审批中心' }),
    ).toBeInTheDocument();
    expect(screen.getByText('WorkflowDefinition 版本')).toBeInTheDocument();
    expect(screen.getByText('我的审批任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布选中版本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '同意' })).toBeDisabled();
  });

  it('opens the rule engine and evaluation trace workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '规则' }));

    expect(
      screen.getByRole('heading', { name: '规则引擎与决策追踪' }),
    ).toBeInTheDocument();
    expect(screen.getByText('RuleSet 版本')).toBeInTheDocument();
    expect(
      screen.getByText('EvaluationTrace 命中与排除解释'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布规则版本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '模拟求值' })).toBeDisabled();
  });

  it('opens the scheduler and asynchronous job workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '调度' }));

    expect(
      screen.getByRole('heading', { name: '调度任务与异步执行中心' }),
    ).toBeInTheDocument();
    expect(screen.getByText('JobDefinition 调度定义')).toBeInTheDocument();
    expect(screen.getByText('JobRun 进度与结果')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建调度定义' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '立即运行' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消运行' })).toBeDisabled();
  });

  it('opens the business event relay and inbox workbench', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '事件' }));

    expect(
      screen.getByRole('heading', { name: '业务事件与投递运维中心' }),
    ).toBeInTheDocument();
    expect(screen.getByText('事务 Outbox 与死信')).toBeInTheDocument();
    expect(screen.getByText('消费者 Inbox 去重回执')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复死信' })).toBeDisabled();
  });
});

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

  it('opens localization, flags, collaboration and print operations', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '收尾' }));
    expect(
      screen.getByRole('heading', { name: '国际化、开关、协同与打印中心' }),
    ).toBeInTheDocument();
    expect(screen.getByText('LocaleContext 与单位换算')).toBeInTheDocument();
    expect(screen.getByText('FeatureFlag 渐进发布')).toBeInTheDocument();
    expect(screen.getByText('评论、@提及与外部可见性')).toBeInTheDocument();
    expect(
      screen.getByText('PrintTemplate、打印机路由与 PrintJob'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '新建 10% 开关版本' }),
    ).toBeDisabled();
  });

  it('opens versioned product, barcode and packaging master data', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '商品' }));
    expect(
      screen.getByRole('heading', { name: '商品、条码与包装主数据' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布新版本' })).toBeDisabled();
    expect(screen.getByText(/ProductVersion 快照/)).toBeInTheDocument();
  });

  it('opens inbound ASN, arrival, receipt task and barcode operations', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '入库' }));
    expect(
      screen.getByRole('heading', { name: '入库接入与收货执行' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '命令栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解析箱托层级' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '车辆到场签到' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '抢单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '条码扫描识别' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '盲收确认' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '授权超短收' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拆托' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '处置差异' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建质检计划' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '计算上架库位' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '执行上架扫描' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '越库匹配' })).toBeDisabled();
  });

  it('opens inventory balances, TraceChain, holds and reservations', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '仓储' }));
    expect(
      screen.getByRole('heading', { name: '库存余额、库内作业与盘点' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登记库存入账' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '变更库存状态' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '冻结库存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '预占库存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '执行移库' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '货主转换' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建盘点' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '审批盘点差异' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分段解冻' })).toBeDisabled();
    expect(
      screen.getByRole('heading', { name: '库存治理、追溯与 ERP 对账' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建调整单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '执行补货' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '运行库龄效期' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批次序列追溯' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '执行 ERP 对账' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/available = onHand - allocated - hold/),
    ).toBeInTheDocument();
  });

  it('opens outbound orders, wave simulation and shortage handling', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '出库' }));
    expect(
      screen.getByRole('heading', { name: '出库、拣选、包装与发运' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接收出库单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'RF 扫描确认' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '复核拣选' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '称重量方与封箱' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认发运' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '配置波次模板' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '模拟波次工作量' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布波次' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '处置缺货' })).toBeDisabled();
  });

  it('opens partner, address and service-zone master data', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '伙伴' }));
    expect(
      screen.getByRole('heading', { name: '伙伴、地址与服务区域' }),
    ).toBeInTheDocument();
    expect(screen.getByText('统一伙伴档案')).toBeInTheDocument();
    expect(screen.getByText('地理编码人工校正队列')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled();
  });
  it('opens warehouse hierarchy and fleet eligibility master data', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    expect(
      screen.getByRole('heading', { name: '仓库层级与车辆司机' }),
    ).toBeInTheDocument();
    expect(screen.getByText('仓库、库区、门岗与月台')).toBeInTheDocument();
    expect(screen.getByText('司机证照到期预警')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停用仓库' })).toBeDisabled();
  });
  it('opens contract, rate, calendar and quality governance', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '治理' }));
    expect(
      screen.getByRole('heading', { name: '合同、费率与主数据治理' }),
    ).toBeInTheDocument();
    expect(screen.getByText('合同与费率版本')).toBeInTheDocument();
    expect(screen.getByText('营业日历、班次与截单窗口')).toBeInTheDocument();
    expect(screen.getByText('质量评估与履约资格')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布费率版本' })).toBeDisabled();
  });
  it('opens mobile warehouse operations with large offline controls', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '作业' }));
    expect(
      screen.getByRole('heading', { name: '移动仓库作业与运营看板' }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('扫描商品、LPN、库位或容器后回车'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认扫描' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新建增值作业' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送打印指令' })).toBeDisabled();
  });
  it('opens multi-channel order intake and version validation', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '订单' }));
    expect(
      screen.getByRole('heading', { name: '多渠道订单接入' }),
    ).toBeInTheDocument();
    expect(screen.getByText('订单草稿与外部编号')).toBeInTheDocument();
    expect(screen.getByText('字段校验与双单位数量')).toBeInTheDocument();
    expect(
      screen.getByText('不可变 OrderVersion 与 ChangeSet'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '校验并提交' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '强制通过警告' })).toBeDisabled();
    expect(screen.getByText('审核风险与人工审批')).toBeInTheDocument();
    expect(screen.getByText('合拆映射与数量金额守恒')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行风险审核' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '解除冻结' })).toBeDisabled();
    expect(screen.getByText('ATP 快照与不确定性')).toBeInTheDocument();
    expect(screen.getByText('候选排除与规则版本')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '执行 ATP 分配' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '释放预占' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '分配规则集代码' })).toHaveValue(
      'ORDER_ALLOCATION_DEFAULT',
    );
    expect(screen.getByText('独立履约单状态机')).toBeInTheDocument();
    expect(screen.getByText('直运与多段运输需求')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '释放履约' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批量释放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '日历自动释放' })).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: '释放营业日历代码' }),
    ).toHaveValue('DEFAULT_OPERATIONS');
    expect(screen.getByText('伙伴确认与承诺反馈')).toBeInTheDocument();
    expect(screen.getByText('供应商 ASN 箱托预告')).toBeInTheDocument();
    expect(screen.getByText('跨域订单时间线投影')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '记录伙伴确认' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '提交供应商 ASN' }),
    ).toBeDisabled();
    expect(screen.getByText('变更影响评估与域确认')).toBeInTheDocument();
    expect(screen.getByText('部分履约、欠货与替代品')).toBeInTheDocument();
    expect(screen.getByText('履约数量守恒投影')).toBeInTheDocument();
    expect(screen.getByText('RMA 逆向全周期')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起订单变更' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消订单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '建议替代品' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '申请 RMA' })).toBeDisabled();
    expect(screen.getByText('订单异常聚合与人工处置')).toBeInTheDocument();
    expect(screen.getByText('订单 SLA 预警与升级')).toBeInTheDocument();
    expect(screen.getByText('商业费用与结算请求')).toBeInTheDocument();
    expect(screen.getByText('客户门户订单自助视图')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '聚合订单异常' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批量指派异常' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批量重试异常' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '执行 SLA 监控' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '批量逐单冻结' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '客户门户预览' })).toBeDisabled();
  });
  it('opens transport order intake and supervisor review', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '运输' }));
    expect(
      screen.getByRole('heading', { name: '运输订单接入与审核' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '查询条件' })).toBeInTheDocument();
    expect(screen.getByText('运输订单池')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接收运输订单' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '审核通过并进入计划' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '冻结异常订单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '退回来源方' })).toBeDisabled();
    expect(screen.getByText('计划批次、合拆运与多段线路')).toBeInTheDocument();
    expect(screen.getByText('PlanningBatch 与订单池')).toBeInTheDocument();
    expect(
      screen.getByText('Shipment、TransportLeg 与独立承运 SLA'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建计划批次' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '领取订单' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '构建合拆运计划' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布运输计划' })).toBeDisabled();
    expect(
      screen.getByText('配载利用率、路线站点与优化方案'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('LoadPlan 与实时 UtilizationMetrics'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('RoutePlan 与可解释 OptimizationScenario'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成配载方案' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '手工拖放重校验' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '生成多权重路线' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '锁定节点重优化' }),
    ).toBeDisabled();
    expect(
      screen.getByText('运力容量、承运委托与竞价分包'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('CapacityPool 原子预占与计划审批'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('CarrierTender、Award 与责任链'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登记承运运力' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '审批并预占运力' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '直接委托承运商' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '发起竞价询价' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '登记转委托责任链' }),
    ).toBeDisabled();
    expect(
      screen.getByText('车辆司机指派、证照与发运确认'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Accepted→Dispatched 资源排班'),
    ).toBeInTheDocument();
    expect(screen.getByText('可用车队与 ComplianceCheck')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '指派车辆司机' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '执行发运证照检查' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '确认发运进入跟踪' }),
    ).toBeDisabled();
    expect(
      screen.getByText('节点计划、司机移动端与在途 ETA'),
    ).toBeInTheDocument();
    expect(screen.getByText('离线队列 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '司机接单' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '按序同步离线队列' }),
    ).toBeDisabled();
    expect(
      screen.getByText('在途地图、异常处置与预约联动'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: '脱敏在途路线图' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行异常检测' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '请求 AMS 预约' }),
    ).toBeDisabled();
    expect(
      screen.getByText('到达签收、POD、索赔与逆向运输'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '记录到达签收' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认 POD' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '批准并生成扣款事实' }),
    ).toBeDisabled();
    expect(screen.getByText('运输计费、预提与双边结算')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '固化计费事实' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '计算承运应付' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '确认承运对账并生成 AP' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '完成双边结算' })).toBeDisabled();
    expect(
      screen.getByText('车队运营、温控 IoT、运输 KPI 与客户追踪'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安排车辆保养' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '接收温控遥测' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成运输 KPI' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '签发客户追踪码' }),
    ).toBeDisabled();
  });

  it('opens immutable billing facts and occurrence-time rate matching', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '结算' }));
    expect(
      screen.getByRole('heading', { name: '计费事实与费率匹配' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('ChargeFact 与 FactCorrection'),
    ).toBeInTheDocument();
    expect(screen.getByText('RateMatch 与 MatchTrace')).toBeInTheDocument();
    expect(
      screen.getByText('版本化计费计算与 CalculationTrace'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('AR/AP 凭证、校验审批与预提冲销'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('对账单、逐行差异与全程留痕'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('调整、索赔扣款与跨订单 / 成本中心分摊'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('开票收票、红冲与收付款核销'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('会计期间关闭、重开与毛利追溯'),
    ).toBeInTheDocument();
    expect(screen.getByText('零命中计费异常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接收计费事实' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '追加事实更正' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '计算 / 重算' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成 AP 草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '预提并过账' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '凭证计算' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '凭证校验' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成对账单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布对账单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '逐行提出差异' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建调整分摊' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '提交调整审批' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '登记部分发票' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '红冲原票' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '登记收付款' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '部分核销' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '启动关账' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '高权限重开' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成毛利报表' })).toBeDisabled();
  });
});

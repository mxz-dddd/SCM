import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row, Space, Tag, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowBase {
  id: string;
  status: string;
  version: number;
}
interface ShipmentRow extends RowBase {
  shipmentNo: string;
}
interface FactRow extends RowBase {
  factNo: string;
  factType: string;
  shipmentId: string;
  source: string;
  uom: string;
  value: string;
}
interface CalculationRow extends RowBase {
  calculationNo: string;
  contractId: string;
  direction: 'PAYABLE' | 'RECEIVABLE';
  shipmentId: string;
  totalAmount: string;
  currency: string;
}
interface StatementRow extends RowBase {
  statementNo: string;
  totalAmount: string;
  currency: string;
}
interface RateSourceRow extends RowBase {
  contractCode: string;
  contractId: string;
  dimensions: Record<string, unknown>;
  rateCardCode: string;
  rateVersionId: string;
  serviceType: string;
}
interface View {
  accruals: RowBase[];
  apVouchers: RowBase[];
  arVouchers: RowBase[];
  calculations: CalculationRow[];
  carrierStatements: StatementRow[];
  customerStatements: StatementRow[];
  exceptions: RowBase[];
  facts: FactRow[];
  rateSources: Array<
    Omit<RateSourceRow, 'id' | 'version'> & { versionNumber: number }
  >;
  shipments: ShipmentRow[];
}
const emptyView: View = {
  accruals: [],
  apVouchers: [],
  arVouchers: [],
  calculations: [],
  carrierStatements: [],
  customerStatements: [],
  exceptions: [],
  facts: [],
  rateSources: [],
  shipments: [],
};
const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['SHIPMENT_POD'],
    id: 'captureFacts',
    label: '固化计费事实',
    requiredPermissions: ['tms.billing.calculate'],
  },
  {
    allowedStatuses: ['FACT_ACTIVE'],
    id: 'calculatePayable',
    label: '计算承运应付',
    requiredPermissions: ['tms.billing.calculate'],
  },
  {
    allowedStatuses: ['FACT_ACTIVE'],
    id: 'calculateReceivable',
    label: '计算客户应收',
    requiredPermissions: ['tms.billing.calculate'],
  },
  {
    allowedStatuses: ['CALC_PAYABLE_CALCULATED'],
    id: 'accrue',
    label: '生成应付预提',
    requiredPermissions: ['tms.billing.accrual'],
  },
  {
    allowedStatuses: ['CALC_PAYABLE_CALCULATED'],
    id: 'carrierStatement',
    label: '生成承运商对账单',
    requiredPermissions: ['tms.billing.statement'],
  },
  {
    allowedStatuses: ['CALC_RECEIVABLE_CALCULATED'],
    id: 'customerStatement',
    label: '生成客户应收单',
    requiredPermissions: ['tms.billing.statement'],
  },
  {
    allowedStatuses: ['CARRIER_DRAFT'],
    id: 'disputeCarrier',
    label: '发起承运争议',
    requiredPermissions: ['tms.billing.statement'],
  },
  {
    allowedStatuses: ['CARRIER_DISPUTED'],
    id: 'adjustCarrier',
    label: '记录争议调整',
    requiredPermissions: ['tms.billing.statement'],
  },
  {
    allowedStatuses: ['CARRIER_DRAFT', 'CARRIER_ADJUSTED'],
    id: 'confirmCarrier',
    label: '确认承运对账并生成 AP',
    requiredPermissions: ['tms.billing.statement'],
  },
  {
    allowedStatuses: ['CUSTOMER_DRAFT', 'CUSTOMER_ADJUSTED'],
    id: 'confirmCustomer',
    label: '确认客户应收并生成 AR',
    requiredPermissions: ['tms.billing.statement'],
  },
  {
    allowedStatuses: ['SHIPMENT_POD'],
    id: 'settle',
    label: '完成双边结算',
    requiredPermissions: ['tms.billing.settle'],
  },
]);

export function FreightBillingPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [shipmentId, setShipmentId] = useState('');
  const [factId, setFactId] = useState('');
  const [calculationId, setCalculationId] = useState('');
  const [rateId, setRateId] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.billing.read',
              'tms.billing.calculate',
              'tms.billing.accrual',
              'tms.billing.statement',
              'tms.billing.settle',
            ]
          : [],
      ),
    [claims],
  );
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const fact = view.facts.find(({ id }) => id === factId);
  const calculation = view.calculations.find(({ id }) => id === calculationId);
  const rateSources: RateSourceRow[] = view.rateSources.map((rate) => ({
    ...rate,
    id: rate.rateVersionId,
    version: rate.versionNumber,
  }));
  const rate = rateSources.find(({ id }) => id === rateId);
  const carrier = view.carrierStatements.find(({ id }) => id === carrierId);
  const customer = view.customerStatements.find(({ id }) => id === customerId);
  const statusFor = (id: string) =>
    id === 'captureFacts' || id === 'settle'
      ? `SHIPMENT_${shipment?.status ?? 'NONE'}`
      : ['calculatePayable', 'calculateReceivable'].includes(id)
        ? `FACT_${fact?.status ?? 'NONE'}`
        : ['accrue', 'carrierStatement', 'customerStatement'].includes(id)
          ? `CALC_${calculation?.direction ?? 'NONE'}_${calculation?.status ?? 'NONE'}`
          : id.includes('Carrier')
            ? `CARRIER_${carrier?.status ?? 'NONE'}`
            : `CUSTOMER_${customer?.status ?? 'NONE'}`;
  const decisions = actions.list().map(({ id }) => {
    const decision = actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: statusFor(id),
    });
    if (['calculatePayable', 'calculateReceivable'].includes(id) && !rate)
      return { ...decision, enabled: false, reason: 'STATUS_DENIED' as const };
    return decision;
  });
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用运输计费工作台');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...init?.headers,
        },
      });
      const body = (await response.json()) as {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      setView(
        (await request('/api/v1/tms/billing/workbench')) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运输计费查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(id: string) {
    if (!decisions.find((item) => item.id === id)?.enabled) return;
    try {
      const today = new Date();
      const period = {
        periodFrom: new Date(today.getTime() - 30 * 86_400_000).toISOString(),
        periodTo: today.toISOString(),
      };
      if (id === 'captureFacts' && shipment)
        await request(`/api/v1/tms/billing/shipments/${shipment.id}/facts`, {
          method: 'POST',
        });
      else if (
        ['calculatePayable', 'calculateReceivable'].includes(id) &&
        fact &&
        rate
      )
        await request(
          `/api/v1/tms/billing/shipments/${fact.shipmentId}/calculations`,
          {
            body: JSON.stringify({
              contractId: rate.contractId,
              dimensions: rate.dimensions,
              direction: id === 'calculatePayable' ? 'PAYABLE' : 'RECEIVABLE',
              freightChargeFactId: fact.id,
              serviceType: rate.serviceType,
            }),
            method: 'POST',
          },
        );
      else if (id === 'accrue' && calculation)
        await request(
          `/api/v1/tms/billing/calculations/${calculation.id}/accruals`,
          {
            body: JSON.stringify({ accountingDate: today.toISOString() }),
            method: 'POST',
          },
        );
      else if (
        ['carrierStatement', 'customerStatement'].includes(id) &&
        calculation
      )
        await request(
          `/api/v1/tms/billing/${id === 'carrierStatement' ? 'carrier' : 'customer'}-statements`,
          {
            body: JSON.stringify({
              calculationIds: [calculation.id],
              contractId: calculation.contractId,
              partnerRef:
                id === 'carrierStatement' ? 'DEMO-CARRIER' : 'DEMO-CUSTOMER',
              pricingSnapshot: { source: 'RATE_CALCULATION' },
              ...period,
            }),
            method: 'POST',
          },
        );
      else if (id.includes('Carrier') && carrier) {
        const decision =
          id === 'disputeCarrier'
            ? 'DISPUTE'
            : id === 'adjustCarrier'
              ? 'ADJUST'
              : 'CONFIRM';
        await request(
          `/api/v1/tms/billing/carrier-statements/${carrier.id}/transition`,
          {
            body: JSON.stringify({
              decision,
              disputeSnapshot: { note: '工作台对账处理' },
              expectedVersion: carrier.version,
            }),
            method: 'POST',
          },
        );
      } else if (id === 'confirmCustomer' && customer)
        await request(
          `/api/v1/tms/billing/customer-statements/${customer.id}/transition`,
          {
            body: JSON.stringify({
              decision: 'CONFIRM',
              disputeSnapshot: { confirmed: true },
              expectedVersion: customer.version,
            }),
            method: 'POST',
          },
        );
      else if (id === 'settle' && shipment)
        await request(`/api/v1/tms/billing/shipments/${shipment.id}/settle`, {
          body: JSON.stringify({ expectedVersion: shipment.version }),
          method: 'POST',
        });
      setNotice('运输计费动作已完成，计费事实、规则轨迹和双边凭证已保留');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运输计费动作失败');
    }
  }
  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    select: (id: string) => void,
    columns: readonly {
      key: keyof T & string;
      label: string;
      render?: (value: unknown) => ReactNode;
    }[],
  ) => (
    <DataGrid
      columns={columns}
      onPageChange={() => undefined}
      onSelectionChange={(ids) => select(ids.at(-1) ?? '')}
      page={1}
      pageSize={200}
      rows={rows}
      selectedIds={selectedId ? [selectedId] : []}
      total={rows.length}
    />
  );
  return (
    <Card title="运输计费、预提与双边结算">
      <Typography.Paragraph>
        计划值与确认值分别固化；费率必须唯一命中并保留完整计算轨迹，缺失或多匹配进入异常。承运应付和客户应收独立计价，双边凭证齐备后运单才可结算。
      </Typography.Paragraph>
      <Space wrap>
        <Tag color="blue">计费事实不可变</Tag>
        <Tag color="orange">费率缺失禁止默认零价</Tag>
        <Tag color="purple">AP / AR 独立</Tag>
        <Tag color="green">POD → Settled</Tag>
      </Space>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="运单、事实与费率版本">
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.facts, factId, setFactId, [
              { key: 'factNo', label: '事实号' },
              { key: 'source', label: '计划/确认' },
              { key: 'factType', label: '类型' },
              { key: 'value', label: '值' },
              { key: 'uom', label: '单位' },
            ])}
            {grid(rateSources, rateId, setRateId, [
              { key: 'contractCode', label: '合同' },
              { key: 'rateCardCode', label: '费率卡' },
              { key: 'serviceType', label: '服务' },
              { key: 'version', label: '费率版本' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="计费结果、对账单与财务凭证">
            {grid(view.calculations, calculationId, setCalculationId, [
              { key: 'calculationNo', label: '计费号' },
              { key: 'direction', label: '方向' },
              { key: 'totalAmount', label: '含税金额' },
              { key: 'currency', label: '币种' },
              { key: 'status', label: '状态' },
            ])}
            {grid(view.carrierStatements, carrierId, setCarrierId, [
              { key: 'statementNo', label: '承运对账单' },
              { key: 'totalAmount', label: '金额' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.customerStatements, customerId, setCustomerId, [
              { key: 'statementNo', label: '客户应收单' },
              { key: 'totalAmount', label: '金额' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            <Typography.Text type="secondary">
              异常{' '}
              {view.exceptions.filter(({ status }) => status === 'OPEN').length}{' '}
              · 预提 {view.accruals.length} · AP {view.apVouchers.length} · AR{' '}
              {view.arVouchers.length}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </Card>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface FactRow {
  businessRef: string;
  chargeType: string;
  currency: string;
  eventId: string;
  id: string;
  occurredAt: string;
  partyRef: string;
  quantityBase: string;
  quantityBaseUom: string;
  serviceType: string;
  sourceDomain: string;
  status: 'ACTIVE';
}

interface MatchRow {
  baseRate: string | null;
  chargeFactId: string;
  currency: string;
  factOccurredAt: string;
  id: string;
  priority: number | null;
  rateVersionNumber: number | null;
  rateVersionRef: string | null;
  status: 'MATCHED' | 'UNMATCHED';
}

interface ExceptionRow {
  chargeFactId: string;
  code: string;
  createdAt: string;
  id: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
}

interface CalculationRow {
  accessorialAmount: string;
  businessRef: string;
  calculatedAt: string;
  calculationNo: string;
  calculationVersion: number;
  chargeFactId: string;
  direction: 'PAYABLE' | 'RECEIVABLE';
  id: string;
  settlementCurrency: string;
  status: 'CALCULATED';
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
}

interface VoucherRow {
  businessType: string;
  currency: string;
  direction: 'PAYABLE' | 'RECEIVABLE';
  id: string;
  partnerRef: string;
  contractSnapshot: readonly { contractRef?: string }[];
  periodFrom: string;
  periodTo: string;
  status:
    | 'APPROVED'
    | 'CALCULATED'
    | 'DRAFT'
    | 'CLOSED'
    | 'INVOICED'
    | 'PAID'
    | 'RECONCILED'
    | 'VALIDATED'
    | 'VOIDED';
  taxAmount: string;
  totalAmount: string;
  version: number;
  voucherNo: string;
}

interface ReconciliationRow {
  contractRef: string;
  currency: string;
  direction: 'PAYABLE' | 'RECEIVABLE';
  id: string;
  lineCount: number;
  partnerRef: string;
  periodFrom: string;
  periodTo: string;
  statementNo: string;
  status: 'ADJUSTED' | 'DISPUTED' | 'DRAFT' | 'PUBLISHED' | 'RECONCILED';
  totalAmount: string;
  version: number;
  voucherCount: number;
}

interface AdjustmentRow {
  adjustmentNo: string;
  adjustmentType: 'ADJUSTMENT' | 'CLAIM_DEDUCTION';
  amount: string;
  currency: string;
  direction: 'DECREASE' | 'INCREASE';
  id: string;
  sourceVoucherId: string;
  status: 'APPROVED' | 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED';
  version: number;
}

interface InvoiceRow {
  direction: 'PAYABLE' | 'RECEIVABLE';
  id: string;
  invoiceDate: string;
  invoiceNo: string;
  kind: 'CREDIT_NOTE' | 'STANDARD';
  statementId: string;
  status: 'ISSUED' | 'PARTIALLY_REVERSED' | 'REVERSED';
  totalAmount: string;
  version: number;
}

interface PaymentRow {
  amount: string;
  currency: string;
  direction: 'PAYABLE' | 'RECEIVABLE';
  id: string;
  paymentNo: string;
  paymentType: 'FEE' | 'NORMAL' | 'REFUND' | 'UNMATCHED';
  status: 'ALLOCATED' | 'PARTIALLY_ALLOCATED' | 'UNMATCHED';
  transactionDate: string;
  unallocatedAmount: string;
  version: number;
}

interface AccountingPeriodRow {
  id: string;
  periodFrom: string;
  periodKey: string;
  periodTo: string;
  status: 'CLOSED' | 'CLOSING' | 'OPEN' | 'REOPENED';
  version: number;
}

interface BillingView {
  accessorialCharges: readonly { calculationId: string; id: string }[];
  calculationLines: readonly {
    calculationId: string;
    id: string;
    lineType: string;
    roundedAmount: string;
  }[];
  calculations: readonly CalculationRow[];
  calculationTraces: readonly { calculationId: string; id: string }[];
  corrections: readonly { chargeFactId: string; id: string }[];
  exceptions: readonly ExceptionRow[];
  facts: readonly FactRow[];
  matches: readonly MatchRow[];
  fxConversions: readonly { calculationId: string; id: string }[];
  taxDetails: readonly { calculationId: string; id: string }[];
  voucherApprovals: readonly {
    id: string;
    status: 'APPROVED' | 'PENDING' | 'REJECTED';
    version: number;
    voucherId: string;
  }[];
  voucherHistories: readonly { id: string; voucherId: string }[];
  voucherLines: readonly { id: string; voucherId: string }[];
  voucherValidations: readonly {
    approvalRequired: boolean;
    id: string;
    passed: boolean;
    voucherId: string;
  }[];
  vouchers: readonly VoucherRow[];
  accrualLines: readonly { accrualVoucherId: string; id: string }[];
  accrualVouchers: readonly {
    accrualNo: string;
    amount: string;
    calculationId: string;
    currency: string;
    id: string;
    status: 'DRAFT' | 'POSTED' | 'REVERSED' | 'VOIDED';
  }[];
  reversalLines: readonly { id: string; reversalVoucherId: string }[];
  reversalVouchers: readonly {
    differenceAmount: string;
    id: string;
    reversalAmount: string;
    reversalNo: string;
    status: 'POSTED';
  }[];
  adjustmentApprovals: readonly {
    adjustmentId: string;
    id: string;
    status: 'APPROVED' | 'PENDING' | 'REJECTED';
    version: number;
  }[];
  adjustmentHistories: readonly { adjustmentId: string; id: string }[];
  adjustmentVouchers: readonly AdjustmentRow[];
  allocationDetails: readonly {
    adjustmentId: string;
    amount: string;
    id: string;
    targetRef: string;
    targetType: string;
  }[];
  reconciliationAttachments: readonly { id: string; statementId: string }[];
  reconciliationCommunications: readonly {
    disputeId: string;
    id: string;
  }[];
  reconciliationDisputes: readonly {
    category: string;
    disputedAmount: string;
    id: string;
    statementId: string;
    statementLineId: string | null;
    status: 'ACCEPTED' | 'ADJUSTED' | 'EVIDENCE_REQUESTED' | 'OPEN' | 'REJECTED';
    version: number;
  }[];
  reconciliationLines: readonly {
    amount: string;
    businessRef: string;
    id: string;
    statementId: string;
    voucherId: string;
  }[];
  reconciliationStatements: readonly ReconciliationRow[];
  reconciliationVersions: readonly { id: string; statementId: string }[];
  accountingPeriods: readonly AccountingPeriodRow[];
  invoiceLines: readonly {
    amount: string;
    id: string;
    invoiceId: string;
    originalInvoiceLineId: string | null;
  }[];
  invoices: readonly InvoiceRow[];
  payments: readonly PaymentRow[];
  periodCloseChecks: readonly { id: string; passed: boolean; periodId: string }[];
  periodHistories: readonly { id: string; periodId: string }[];
  settlementAllocations: readonly { id: string; paymentId: string }[];
  settlementMetricTraces: readonly { id: string; metricId: string }[];
  settlementMetrics: readonly { id: string; reportId: string }[];
  settlementReports: readonly {
    dimensionType: string;
    id: string;
    marginAmount: string;
    reportVersion: number;
  }[];
}

const actions = createActionRegistry<'ACTIVE' | 'NONE'>([
  {
    id: 'receive',
    label: '接收计费事实',
    requiredPermissions: ['billing.fact.ingest'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    confirmMessage: '原计费事实不可覆盖，将追加一条更正事实并重新匹配费率。',
    id: 'correct',
    label: '追加事实更正',
    requiredPermissions: ['billing.fact.correct'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    confirmMessage: '将按当前最新事实更正与已匹配费率追加一个计算版本。',
    id: 'calculate',
    label: '计算 / 重算',
    requiredPermissions: ['billing.calculation.execute'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'createVoucher',
    label: '生成 AP 草稿',
    requiredPermissions: ['billing.voucher.manage'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'createAccrual',
    label: '预提并过账',
    requiredPermissions: ['billing.accrual.manage'],
  },
]);

const voucherActions = createActionRegistry<VoucherRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['APPROVED'],
    id: 'createStatement',
    label: '生成对账单',
    requiredPermissions: ['billing.reconciliation.manage'],
  },
  {
    allowedStatuses: ['DRAFT'],
    id: 'voucherCalculate',
    label: '凭证计算',
    requiredPermissions: ['billing.voucher.manage'],
  },
  {
    allowedStatuses: ['CALCULATED'],
    id: 'voucherValidate',
    label: '凭证校验',
    requiredPermissions: ['billing.voucher.validate'],
  },
  {
    allowedStatuses: ['VALIDATED'],
    id: 'voucherApprove',
    label: '批准凭证',
    requiredPermissions: ['billing.voucher.approve'],
  },
  {
    allowedStatuses: ['VALIDATED'],
    id: 'voucherReject',
    label: '驳回凭证',
    requiredPermissions: ['billing.voucher.approve'],
  },
]);

const reconciliationActions = createActionRegistry<
  ReconciliationRow['status'] | 'NONE'
>([
  {
    allowedStatuses: ['DRAFT'],
    id: 'publishStatement',
    label: '发布对账单',
    requiredPermissions: ['billing.reconciliation.manage'],
  },
  {
    allowedStatuses: ['PUBLISHED', 'DISPUTED'],
    id: 'raiseDispute',
    label: '逐行提出差异',
    requiredPermissions: ['billing.reconciliation.respond'],
  },
  {
    allowedStatuses: ['DISPUTED'],
    id: 'acceptDispute',
    label: '接受差异',
    requiredPermissions: ['billing.reconciliation.respond'],
  },
  {
    allowedStatuses: ['DISPUTED'],
    id: 'createAdjustment',
    label: '创建调整分摊',
    requiredPermissions: ['billing.adjustment.manage'],
  },
  {
    allowedStatuses: ['PUBLISHED', 'DISPUTED', 'ADJUSTED'],
    id: 'reconcileStatement',
    label: '确认对账',
    requiredPermissions: ['billing.reconciliation.manage'],
  },
  {
    allowedStatuses: ['RECONCILED'],
    id: 'createInvoice',
    label: '登记部分发票',
    requiredPermissions: ['billing.invoice.manage'],
  },
]);

const adjustmentActions = createActionRegistry<AdjustmentRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['DRAFT'],
    id: 'submitAdjustment',
    label: '提交调整审批',
    requiredPermissions: ['billing.adjustment.manage'],
  },
  {
    allowedStatuses: ['PENDING_APPROVAL'],
    id: 'approveAdjustment',
    label: '批准调整',
    requiredPermissions: ['billing.adjustment.approve'],
  },
  {
    allowedStatuses: ['PENDING_APPROVAL'],
    id: 'rejectAdjustment',
    label: '驳回调整',
    requiredPermissions: ['billing.adjustment.approve'],
  },
  {
    allowedStatuses: ['APPROVED'],
    id: 'postAdjustment',
    label: '过账调整',
    requiredPermissions: ['billing.adjustment.manage'],
  },
]);

const invoiceActions = createActionRegistry<InvoiceRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['ISSUED', 'PARTIALLY_REVERSED'],
    id: 'creditInvoice',
    label: '红冲原票',
    requiredPermissions: ['billing.invoice.manage'],
  },
]);

const paymentActions = createActionRegistry<PaymentRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['UNMATCHED', 'PARTIALLY_ALLOCATED'],
    id: 'allocatePayment',
    label: '部分核销',
    requiredPermissions: ['billing.payment.manage'],
  },
]);

const periodActions = createActionRegistry<
  AccountingPeriodRow['status'] | 'NONE'
>([
  {
    allowedStatuses: ['OPEN', 'REOPENED'],
    id: 'startPeriodClose',
    label: '启动关账',
    requiredPermissions: ['billing.period.close'],
  },
  {
    allowedStatuses: ['CLOSING'],
    id: 'closePeriod',
    label: '执行关账检查',
    requiredPermissions: ['billing.period.close'],
  },
  {
    allowedStatuses: ['CLOSED'],
    id: 'reopenPeriod',
    label: '高权限重开',
    requiredPermissions: ['billing.period.reopen'],
  },
]);

const financeActions = createActionRegistry<'NONE'>([
  {
    id: 'registerPayment',
    label: '登记收付款',
    requiredPermissions: ['billing.payment.manage'],
  },
  {
    id: 'createPeriod',
    label: '新建会计期间',
    requiredPermissions: ['billing.period.close'],
  },
  {
    id: 'generateReport',
    label: '生成毛利报表',
    requiredPermissions: ['billing.report.generate'],
  },
]);

export function BillingFactWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<BillingView>({
    accessorialCharges: [],
    accountingPeriods: [],
    accrualLines: [],
    accrualVouchers: [],
    adjustmentApprovals: [],
    adjustmentHistories: [],
    adjustmentVouchers: [],
    allocationDetails: [],
    calculationLines: [],
    calculations: [],
    calculationTraces: [],
    corrections: [],
    exceptions: [],
    facts: [],
    invoiceLines: [],
    invoices: [],
    matches: [],
    payments: [],
    periodCloseChecks: [],
    periodHistories: [],
    reconciliationAttachments: [],
    reconciliationCommunications: [],
    reconciliationDisputes: [],
    reconciliationLines: [],
    reconciliationStatements: [],
    reconciliationVersions: [],
    reversalLines: [],
    reversalVouchers: [],
    settlementAllocations: [],
    settlementMetricTraces: [],
    settlementMetrics: [],
    settlementReports: [],
    fxConversions: [],
    taxDetails: [],
    voucherApprovals: [],
    voucherHistories: [],
    voucherLines: [],
    voucherValidations: [],
    vouchers: [],
  });
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<
    readonly string[]
  >([]);
  const [selectedStatementIds, setSelectedStatementIds] = useState<
    readonly string[]
  >([]);
  const [selectedAdjustmentIds, setSelectedAdjustmentIds] = useState<
    readonly string[]
  >([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<
    readonly string[]
  >([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<
    readonly string[]
  >([]);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<
    readonly string[]
  >([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const selected = view.facts.find(({ id }) => id === selectedIds[0]);
  const selectedVoucher = view.vouchers.find(
    ({ id }) => id === selectedVoucherIds[0],
  );
  const selectedStatement = view.reconciliationStatements.find(
    ({ id }) => id === selectedStatementIds[0],
  );
  const selectedAdjustment = view.adjustmentVouchers.find(
    ({ id }) => id === selectedAdjustmentIds[0],
  );
  const selectedInvoice = view.invoices.find(
    ({ id }) => id === selectedInvoiceIds[0],
  );
  const selectedPayment = view.payments.find(
    ({ id }) => id === selectedPaymentIds[0],
  );
  const selectedPeriod = view.accountingPeriods.find(
    ({ id }) => id === selectedPeriodIds[0],
  );
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'billing.fact.read',
              'billing.invoice.manage',
              'billing.payment.manage',
              'billing.period.close',
              'billing.period.reopen',
              'billing.fact.ingest',
              'billing.fact.correct',
              'billing.calculation.execute',
              'billing.voucher.manage',
              'billing.voucher.validate',
              'billing.voucher.approve',
              'billing.accrual.manage',
              'billing.adjustment.approve',
              'billing.adjustment.manage',
              'billing.reconciliation.manage',
              'billing.reconciliation.respond',
              'billing.report.generate',
            ]
          : [],
      ),
    [claims],
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selected?.status ?? 'NONE',
    }),
  );
  const voucherDecisions = voucherActions.list().map(({ id }) =>
    voucherActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedVoucher?.status ?? 'NONE',
    }),
  );
  const reconciliationDecisions = reconciliationActions.list().map(({ id }) =>
    reconciliationActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedStatement?.status ?? 'NONE',
    }),
  );
  const adjustmentDecisions = adjustmentActions.list().map(({ id }) =>
    adjustmentActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedAdjustment?.status ?? 'NONE',
    }),
  );
  const invoiceDecisions = invoiceActions.list().map(({ id }) =>
    invoiceActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedInvoice?.status ?? 'NONE',
    }),
  );
  const paymentDecisions = paymentActions.list().map(({ id }) =>
    paymentActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedPayment?.status ?? 'NONE',
    }),
  );
  const periodDecisions = periodActions.list().map(({ id }) =>
    periodActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedPeriod?.status ?? 'NONE',
    }),
  );
  const financeDecisions = financeActions.list().map(({ id }) =>
    financeActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: 'NONE',
    }),
  );
  const facts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return view.facts;
    return view.facts.filter((fact) =>
      [fact.businessRef, fact.chargeType, fact.eventId, fact.serviceType].some(
        (value) => value.toLowerCase().includes(normalized),
      ),
    );
  }, [query, view.facts]);

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用计费事实工作台');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...(init?.method && init.method !== 'GET'
            ? { 'Idempotency-Key': crypto.randomUUID() }
            : {}),
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
      const result = (await request(
        '/api/v1/billing/workbench',
      )) as unknown as BillingView;
      setView(result);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '计费事实查询失败');
    }
  }, [accessToken, claims, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      if (actionId === 'receive') {
        const now = new Date();
        await request('/api/v1/billing/facts', {
          body: JSON.stringify({
            aggregateRef: `DEMO-SHIPMENT-${now.getTime()}`,
            businessRef: `DEMO-BILLING-${now.getTime()}`,
            chargeType: 'TRANSPORT_LINEHAUL',
            currency: 'CNY',
            dimensions: { equipmentType: 'VAN', route: 'SHA-SUZ' },
            eventId: crypto.randomUUID(),
            occurredAt: now.toISOString(),
            partyRef: '00000000-0000-4000-8000-000000000001',
            quantityBase: '1000',
            quantityBaseUom: 'KG',
            quantityOriginal: '1000',
            quantityUom: 'KG',
            routeRef: 'SHA-SUZ',
            serviceType: 'LINEHAUL',
            sourceDomain: 'TMS',
            sourceEventType: 'shipment.delivered.v1',
            sourceSnapshot: { channel: 'WORKBENCH', demo: true },
          }),
          method: 'POST',
        });
        setNotice('计费事实已去重接收，并按发生时点完成费率匹配');
      } else if (actionId === 'correct' && selected) {
        await request(`/api/v1/billing/facts/${selected.id}/corrections`, {
          body: JSON.stringify({
            corrected: {
              quantityBase: String(Number(selected.quantityBase) + 1),
              quantityOriginal: String(Number(selected.quantityBase) + 1),
            },
            reason: '工作台复核计量后追加更正',
          }),
          method: 'POST',
        });
        setNotice('更正事实已追加，原事实与原 MatchTrace 保持不变');
      } else if (actionId === 'calculate' && selected) {
        const calculated = (await request('/api/v1/billing/calculations', {
          body: JSON.stringify({
            chargeFactId: selected.id,
            direction: 'PAYABLE',
            settlementCurrency: selected.currency,
            tax: { mode: 'EXCLUSIVE', rate: '6' },
          }),
          method: 'POST',
        })) as { calculationVersion?: number };
        setNotice(
          `计费计算版本 V${calculated.calculationVersion ?? '?'} 已追加，历史版本保持不变`,
        );
      } else if (actionId === 'createVoucher' && selected) {
        const calculation = view.calculations.find(
          (item) => item.chargeFactId === selected.id,
        );
        if (!calculation) throw new Error('请先为所选事实生成计费计算版本');
        const occurredAt = selected.occurredAt.slice(0, 10);
        await request('/api/v1/billing/vouchers', {
          body: JSON.stringify({
            approvalThreshold: '10000',
            businessType: selected.chargeType,
            calculationIds: [calculation.id],
            direction: calculation.direction,
            partnerRef: selected.partyRef,
            periodFrom: occurredAt,
            periodTo: occurredAt,
          }),
          method: 'POST',
        });
        setNotice('AR/AP 凭证草稿已生成，计算行尚未入账');
      } else if (selected) {
        const calculation = view.calculations.find(
          (item) =>
            item.chargeFactId === selected.id && item.direction === 'PAYABLE',
        );
        if (!calculation) throw new Error('请先生成应付计费计算');
        const accrual = (await request(
          `/api/v1/billing/calculations/${calculation.id}/accruals`,
          {
            body: JSON.stringify({
              accountingDate: selected.occurredAt.slice(0, 10),
            }),
            method: 'POST',
          },
        )) as { accrualVoucherId: string; version: number };
        await request(
          `/api/v1/billing/accruals/${accrual.accrualVoucherId}/post`,
          {
            body: JSON.stringify({ expectedVersion: accrual.version }),
            method: 'POST',
          },
        );
        setNotice('预提凭证已生成并过账，实际凭证批准时将自动追加冲销');
      }
      setSelectedIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '计费事实动作失败');
    }
  }

  async function executeVoucher(actionId: string) {
    const decision = voucherDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedVoucher) return;
    try {
      if (actionId === 'createStatement') {
        const contractRef = selectedVoucher.contractSnapshot.find(
          (item) => item.contractRef,
        )?.contractRef;
        if (!contractRef) throw new Error('凭证缺少可用于对账的合同快照');
        await request('/api/v1/billing/reconciliation-statements', {
          body: JSON.stringify({
            contractRef,
            partnerSnapshot: { partnerRef: selectedVoucher.partnerRef },
            periodFrom: selectedVoucher.periodFrom.slice(0, 10),
            periodTo: selectedVoucher.periodTo.slice(0, 10),
            voucherIds: [selectedVoucher.id],
          }),
          method: 'POST',
        });
      } else if (actionId === 'voucherCalculate')
        await request(
          `/api/v1/billing/vouchers/${selectedVoucher.id}/calculate`,
          {
            body: JSON.stringify({ expectedVersion: selectedVoucher.version }),
            method: 'POST',
          },
        );
      else if (actionId === 'voucherValidate')
        await request(
          `/api/v1/billing/vouchers/${selectedVoucher.id}/validate`,
          {
            body: JSON.stringify({ expectedVersion: selectedVoucher.version }),
            method: 'POST',
          },
        );
      else {
        const task = view.voucherApprovals.find(
          (item) =>
            item.voucherId === selectedVoucher.id && item.status === 'PENDING',
        );
        if (!task) throw new Error('该凭证没有待处理审批任务');
        await request(`/api/v1/billing/voucher-approvals/${task.id}/decide`, {
          body: JSON.stringify({
            decision: actionId === 'voucherApprove' ? 'APPROVE' : 'REJECT',
            expectedTaskVersion: task.version,
            expectedVoucherVersion: selectedVoucher.version,
            reason:
              actionId === 'voucherApprove'
                ? '财务工作台复核通过'
                : '财务工作台驳回补充材料',
          }),
          method: 'POST',
        });
      }
      setNotice('凭证状态已按命令推进并保留完整状态历史');
      setSelectedVoucherIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '凭证动作失败');
    }
  }

  async function executeReconciliation(actionId: string) {
    const decision = reconciliationDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedStatement) return;
    try {
      if (actionId === 'publishStatement')
        await request(
          `/api/v1/billing/reconciliation-statements/${selectedStatement.id}/publish`,
          {
            body: JSON.stringify({ expectedVersion: selectedStatement.version }),
            method: 'POST',
          },
        );
      else if (actionId === 'raiseDispute') {
        const line = view.reconciliationLines.find(
          (item) => item.statementId === selectedStatement.id,
        );
        if (!line) throw new Error('对账单没有可提出差异的明细行');
        await request(
          `/api/v1/billing/reconciliation-statements/${selectedStatement.id}/disputes`,
          {
            body: JSON.stringify({
              category: 'RATE',
              description: '伙伴复核费率存在差异，请财务确认',
              disputedAmount: line.amount,
              evidenceRefs: [`workbench-evidence-${crypto.randomUUID()}`],
              expectedStatementVersion: selectedStatement.version,
              raisedByType: 'PARTNER',
              statementLineId: line.id,
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'acceptDispute') {
        const dispute = view.reconciliationDisputes.find(
          (item) =>
            item.statementId === selectedStatement.id &&
            ['OPEN', 'EVIDENCE_REQUESTED'].includes(item.status),
        );
        if (!dispute) throw new Error('没有待处理的对账差异');
        await request(
          `/api/v1/billing/reconciliation-disputes/${dispute.id}/respond`,
          {
            body: JSON.stringify({
              action: 'ACCEPT',
              expectedVersion: dispute.version,
              message: '财务复核后接受该差异，进入调整审批',
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'createAdjustment') {
        const dispute = view.reconciliationDisputes.find(
          (item) =>
            item.statementId === selectedStatement.id &&
            item.status === 'ACCEPTED',
        );
        const line = dispute
          ? view.reconciliationLines.find(
              (item) => item.id === dispute.statementLineId,
            )
          : undefined;
        if (!dispute || !line)
          throw new Error('请先接受一条有原凭证行的对账差异');
        await request('/api/v1/billing/adjustments', {
          body: JSON.stringify({
            adjustmentType: 'ADJUSTMENT',
            allocations: [
              {
                amount: dispute.disputedAmount,
                targetRef: line.businessRef,
                targetSnapshot: { statementLineId: line.id },
                targetType: 'ORDER',
              },
            ],
            amount: dispute.disputedAmount,
            direction: 'DECREASE',
            disputeId: dispute.id,
            reason: '对账费率差异调整',
            sourceVoucherId: line.voucherId,
            statementId: selectedStatement.id,
          }),
          method: 'POST',
        });
      } else if (actionId === 'createInvoice') {
        const line = view.reconciliationLines.find(
          (item) => item.statementId === selectedStatement.id,
        );
        if (!line) throw new Error('对账单没有可开票明细');
        await request('/api/v1/billing/invoices', {
          body: JSON.stringify({
            invoiceDate: new Date().toISOString().slice(0, 10),
            invoiceNo: `WORKBENCH-INV-${Date.now()}`,
            invoicePartyRef: selectedStatement.partnerRef,
            lines: [
              {
                amount: String(Number(line.amount) / 2),
                sourceRef: line.id,
                sourceType: 'STATEMENT_LINE',
              },
            ],
            statementId: selectedStatement.id,
          }),
          method: 'POST',
        });
      } else
        await request(
          `/api/v1/billing/reconciliation-statements/${selectedStatement.id}/reconcile`,
          {
            body: JSON.stringify({ expectedVersion: selectedStatement.version }),
            method: 'POST',
          },
        );
      setNotice('对账单、差异沟通与版本轨迹已按领域命令更新');
      setSelectedStatementIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '对账动作失败');
    }
  }

  async function executeAdjustment(actionId: string) {
    const decision = adjustmentDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedAdjustment) return;
    try {
      if (actionId === 'submitAdjustment')
        await request(
          `/api/v1/billing/adjustments/${selectedAdjustment.id}/submit`,
          {
            body: JSON.stringify({ expectedVersion: selectedAdjustment.version }),
            method: 'POST',
          },
        );
      else if (actionId === 'postAdjustment')
        await request(
          `/api/v1/billing/adjustments/${selectedAdjustment.id}/post`,
          {
            body: JSON.stringify({ expectedVersion: selectedAdjustment.version }),
            method: 'POST',
          },
        );
      else {
        const task = view.adjustmentApprovals.find(
          (item) =>
            item.adjustmentId === selectedAdjustment.id &&
            item.status === 'PENDING',
        );
        if (!task) throw new Error('该调整单没有待处理审批任务');
        await request(`/api/v1/billing/adjustment-approvals/${task.id}/decide`, {
          body: JSON.stringify({
            decision: actionId === 'approveAdjustment' ? 'APPROVE' : 'REJECT',
            expectedAdjustmentVersion: selectedAdjustment.version,
            expectedTaskVersion: task.version,
            reason:
              actionId === 'approveAdjustment'
                ? '调整分摊复核通过'
                : '调整分摊需重新提交',
          }),
          method: 'POST',
        });
      }
      setNotice('调整单状态已推进，原凭证金额与历史明细未被覆盖');
      setSelectedAdjustmentIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '调整动作失败');
    }
  }

  async function executeInvoice(actionId: string) {
    const decision = invoiceDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedInvoice) return;
    try {
      const line = view.invoiceLines.find(
        (item) => item.invoiceId === selectedInvoice.id,
      );
      if (!line || selectedInvoice.kind !== 'STANDARD')
        throw new Error('请选择仍可红冲的原始发票');
      await request(
        `/api/v1/billing/invoices/${selectedInvoice.id}/credit-notes`,
        {
          body: JSON.stringify({
            invoiceDate: new Date().toISOString().slice(0, 10),
            invoiceNo: `WORKBENCH-CN-${Date.now()}`,
            lines: [{ amount: '1', originalInvoiceLineId: line.id }],
            reason: '工作台红冲演示，逐行引用原票',
          }),
          method: 'POST',
        },
      );
      setNotice('红冲发票已追加，累计红冲金额未超过原票行');
      setSelectedInvoiceIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发票动作失败');
    }
  }

  async function executePayment(actionId: string) {
    const decision = paymentDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedPayment) return;
    try {
      const invoice = view.invoices.find(
        (item) =>
          item.direction === selectedPayment.direction &&
          (Number(item.totalAmount) < 0) ===
            (Number(selectedPayment.amount) < 0),
      );
      if (!invoice) throw new Error('没有方向与符号匹配的待核销发票');
      const amount = Math.min(
        Math.abs(Number(selectedPayment.unallocatedAmount)),
        Math.abs(Number(invoice.totalAmount)),
      );
      await request(
        `/api/v1/billing/payments/${selectedPayment.id}/allocations`,
        {
          body: JSON.stringify({
            allocations: [
              {
                amount: String(amount),
                targetRef: invoice.id,
                targetType: 'INVOICE',
              },
            ],
            expectedVersion: selectedPayment.version,
          }),
          method: 'POST',
        },
      );
      setNotice('收付款已部分核销，退款与手续费按独立金额保留');
      setSelectedPaymentIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '核销动作失败');
    }
  }

  async function executePeriod(actionId: string) {
    const decision = periodDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedPeriod) return;
    try {
      if (actionId === 'startPeriodClose')
        await request(`/api/v1/billing/periods/${selectedPeriod.id}/start-close`, {
          body: JSON.stringify({ expectedVersion: selectedPeriod.version }),
          method: 'POST',
        });
      else if (actionId === 'closePeriod')
        await request(`/api/v1/billing/periods/${selectedPeriod.id}/close`, {
          body: JSON.stringify({ expectedVersion: selectedPeriod.version }),
          method: 'POST',
        });
      else
        await request(`/api/v1/billing/periods/${selectedPeriod.id}/reopen`, {
          body: JSON.stringify({
            expectedVersion: selectedPeriod.version,
            reason: '财务主管批准补录迟到 ERP 数据',
          }),
          method: 'POST',
        });
      setNotice('会计期间状态已推进并保存关闭检查与高权限审计');
      setSelectedPeriodIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '期间动作失败');
    }
  }

  async function executeFinance(actionId: string) {
    const decision = financeDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    try {
      const today = new Date();
      if (actionId === 'registerPayment') {
        const invoice = view.invoices[0];
        if (!invoice) throw new Error('请先登记一张发票');
        const statement = view.reconciliationStatements.find(
          (item) => item.id === invoice.statementId,
        );
        await request('/api/v1/billing/payments', {
          body: JSON.stringify({
            amount: String(Math.abs(Number(invoice.totalAmount))),
            counterpartyRef: statement?.partnerRef ?? 'WORKBENCH-PARTNER',
            currency: statement?.currency ?? 'CNY',
            direction: invoice.direction,
            externalRef: `WORKBENCH-PAY-${Date.now()}`,
            paymentType: Number(invoice.totalAmount) < 0 ? 'REFUND' : 'NORMAL',
            source: 'MANUAL',
            transactionDate: today.toISOString().slice(0, 10),
          }),
          method: 'POST',
        });
      } else if (actionId === 'createPeriod') {
        const year = today.getUTCFullYear();
        const month = String(today.getUTCMonth() + 1).padStart(2, '0');
        const last = new Date(Date.UTC(year, today.getUTCMonth() + 1, 0));
        await request('/api/v1/billing/periods', {
          body: JSON.stringify({
            periodFrom: `${year}-${month}-01`,
            periodKey: `${year}-${month}`,
            periodTo: last.toISOString().slice(0, 10),
          }),
          method: 'POST',
        });
      } else {
        const voucher = view.vouchers[0];
        const periodFrom = voucher?.periodFrom.slice(0, 10) ?? `${today.getUTCFullYear()}-01-01`;
        const periodTo = voucher?.periodTo.slice(0, 10) ?? today.toISOString().slice(0, 10);
        await request('/api/v1/billing/settlement-reports', {
          body: JSON.stringify({
            currency: voucher?.currency ?? 'CNY',
            dimensionType: 'ORDER',
            periodFrom,
            periodTo,
          }),
          method: 'POST',
        });
      }
      setNotice('财务闭环命令已执行，报表可追溯到计算来源行');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '财务闭环动作失败');
    }
  }

  return (
    <section className="billing-fact-workbench">
      <Typography.Title level={2}>计费事实与费率匹配</Typography.Title>
      <Typography.Paragraph>
        按事件与业务收费键双重去重接收 WMS、TMS、AMS
        事实；原事实不可覆盖，更正追加留痕，费率按业务发生时点与多维优先级匹配。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="ChargeFact 与 FactCorrection">
        <QueryPanel
          fields={[
            {
              label: '业务引用 / 收费类型 / 事件',
              name: 'query',
              quick: true,
            },
          ]}
          onQuery={(values) => setQuery(values.query ?? '')}
          onReset={() => setQuery('')}
        />
        <CommandBar
          actions={decisions}
          onAction={(action) => void execute(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'businessRef', label: '业务引用' },
            { key: 'chargeType', label: '收费类型' },
            { key: 'sourceDomain', label: '来源域' },
            { key: 'quantityBase', label: '基础数量' },
            { key: 'quantityBaseUom', label: '基础单位' },
            { key: 'serviceType', label: '服务类型' },
            { key: 'currency', label: '币种' },
            { key: 'occurredAt', label: '业务发生时点' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={facts}
          selectedIds={selectedIds}
          total={facts.length}
        />
      </Card>
      <Card title="版本化计费计算与 CalculationTrace">
        <Typography.Paragraph>
          支持起步价、阶梯、最低费、封顶与条件附加费；税、汇率来源及每次舍入差额独立留痕，重算只追加新版本。
        </Typography.Paragraph>
        <DataGrid
          columns={[
            { key: 'calculationNo', label: '计算单号' },
            { key: 'businessRef', label: '业务引用' },
            { key: 'direction', label: '方向' },
            { key: 'calculationVersion', label: '计算版本' },
            { key: 'subtotalAmount', label: '基础金额' },
            { key: 'accessorialAmount', label: '附加费' },
            { key: 'taxAmount', label: '税额' },
            { key: 'totalAmount', label: '结算金额' },
            { key: 'settlementCurrency', label: '结算币种' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'calculatedAt', label: '计算时间' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={50}
          rows={view.calculations}
          total={view.calculations.length}
        />
      </Card>
      <Card title="AR/AP 凭证、校验审批与预提冲销">
        <CommandBar
          actions={voucherDecisions}
          onAction={(action) => void executeVoucher(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'voucherNo', label: '凭证号' },
            { key: 'direction', label: 'AR/AP' },
            { key: 'businessType', label: '业务类型' },
            { key: 'partnerRef', label: '伙伴' },
            { key: 'totalAmount', label: '金额' },
            { key: 'taxAmount', label: '税额' },
            { key: 'currency', label: '币种' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedVoucherIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={view.vouchers}
          selectedIds={selectedVoucherIds}
          total={view.vouchers.length}
        />
        <Typography.Paragraph>
          预提 {view.accrualVouchers.length} 笔；自动冲销{' '}
          {view.reversalVouchers.length} 笔；审批任务{' '}
          {view.voucherApprovals.length}{' '}
          笔。每条计算来源只允许进入一个有效凭证。
        </Typography.Paragraph>
      </Card>
      <Card title="对账单、逐行差异与全程留痕">
        <CommandBar
          actions={reconciliationDecisions}
          onAction={(action) => void executeReconciliation(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'statementNo', label: '对账单号' },
            { key: 'direction', label: 'AR/AP' },
            { key: 'partnerRef', label: '伙伴' },
            { key: 'contractRef', label: '合同引用' },
            { key: 'periodFrom', label: '期间起' },
            { key: 'periodTo', label: '期间止' },
            { key: 'voucherCount', label: '凭证数' },
            { key: 'lineCount', label: '明细数' },
            { key: 'totalAmount', label: '对账金额' },
            { key: 'currency', label: '币种' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedStatementIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={view.reconciliationStatements}
          selectedIds={selectedStatementIds}
          total={view.reconciliationStatements.length}
        />
        <Typography.Paragraph>
          已记录差异 {view.reconciliationDisputes.length} 条、沟通与证据版本{' '}
          {view.reconciliationCommunications.length} 条；发布后的明细与附件只追加留痕。
        </Typography.Paragraph>
      </Card>
      <Card title="调整、索赔扣款与跨订单 / 成本中心分摊">
        <CommandBar
          actions={adjustmentDecisions}
          onAction={(action) => void executeAdjustment(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'adjustmentNo', label: '调整单号' },
            { key: 'adjustmentType', label: '调整类型' },
            { key: 'direction', label: '增减方向' },
            { key: 'sourceVoucherId', label: '原凭证' },
            { key: 'amount', label: '调整金额' },
            { key: 'currency', label: '币种' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedAdjustmentIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={view.adjustmentVouchers}
          selectedIds={selectedAdjustmentIds}
          total={view.adjustmentVouchers.length}
        />
        <Typography.Paragraph>
          分摊明细 {view.allocationDetails.length} 条、审批任务{' '}
          {view.adjustmentApprovals.length} 条；调整始终引用原凭证并保持分摊金额守恒。
        </Typography.Paragraph>
      </Card>
      <Card title="开票收票、红冲与收付款核销">
        <CommandBar
          actions={financeDecisions}
          onAction={(action) => void executeFinance(action.id)}
        />
        <CommandBar
          actions={invoiceDecisions}
          onAction={(action) => void executeInvoice(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'invoiceNo', label: '发票号码' },
            { key: 'kind', label: '票据类型' },
            { key: 'direction', label: '收 / 开票' },
            { key: 'invoiceDate', label: '票据日期' },
            { key: 'totalAmount', label: '含税金额' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedInvoiceIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={view.invoices}
          selectedIds={selectedInvoiceIds}
          total={view.invoices.length}
        />
        <CommandBar
          actions={paymentDecisions}
          onAction={(action) => void executePayment(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'paymentNo', label: '收付款号' },
            { key: 'paymentType', label: '类型' },
            { key: 'direction', label: '方向' },
            { key: 'amount', label: '金额' },
            { key: 'unallocatedAmount', label: '未核销' },
            { key: 'currency', label: '币种' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedPaymentIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={view.payments}
          selectedIds={selectedPaymentIds}
          total={view.payments.length}
        />
        <Typography.Paragraph>
          发票行 {view.invoiceLines.length} 条、核销事实{' '}
          {view.settlementAllocations.length} 条；部分、多票、红冲、退款与手续费均不覆盖原记录。
        </Typography.Paragraph>
      </Card>
      <Card title="会计期间关闭、重开与毛利追溯">
        <CommandBar
          actions={periodDecisions}
          onAction={(action) => void executePeriod(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'periodKey', label: '期间' },
            { key: 'periodFrom', label: '开始' },
            { key: 'periodTo', label: '结束' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedPeriodIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={view.accountingPeriods}
          selectedIds={selectedPeriodIds}
          total={view.accountingPeriods.length}
        />
        <DataGrid
          columns={[
            { key: 'dimensionType', label: '分析维度' },
            { key: 'reportVersion', label: '报表版本' },
            { key: 'marginAmount', label: '毛利' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={50}
          rows={view.settlementReports}
          total={view.settlementReports.length}
        />
        <Typography.Paragraph>
          关闭检查 {view.periodCloseChecks.length} 次；毛利指标{' '}
          {view.settlementMetrics.length} 条，可下钻计算来源{' '}
          {view.settlementMetricTraces.length} 条。
        </Typography.Paragraph>
      </Card>
      <Card title="RateMatch 与 MatchTrace">
        <DataGrid
          columns={[
            { key: 'chargeFactId', label: '事实 ID' },
            {
              key: 'status',
              label: '匹配状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'rateVersionRef', label: '费率版本' },
            { key: 'rateVersionNumber', label: '版本号' },
            { key: 'priority', label: '优先级' },
            { key: 'baseRate', label: '基础费率' },
            { key: 'currency', label: '币种' },
            { key: 'factOccurredAt', label: '匹配时点' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={50}
          rows={view.matches}
          total={view.matches.length}
        />
      </Card>
      <Card title="零命中计费异常">
        <DataGrid
          columns={[
            { key: 'chargeFactId', label: '事实 ID' },
            { key: 'code', label: '异常码' },
            { key: 'reason', label: '原因' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'createdAt', label: '创建时间' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={50}
          rows={view.exceptions}
          total={view.exceptions.length}
        />
      </Card>
    </section>
  );
}

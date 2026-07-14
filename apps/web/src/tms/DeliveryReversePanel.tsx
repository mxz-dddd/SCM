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
interface ItemRow extends RowBase {
  quantityBase: string;
  shipmentId: string;
}
interface PodRow extends RowBase {
  pageCount: number;
  podNo: string;
  shipmentId: string;
}
interface VarianceRow extends RowBase {
  baseUom: string;
  differenceQuantityBase: string;
  shipmentId: string;
  type: string;
}
interface ClaimRow extends RowBase {
  claimNo: string;
  claimedAmount: string;
  currency: string;
  shipmentId: string;
}
interface FileRow extends RowBase {
  originalName: string;
  scanStatus: string;
}
interface View {
  claims: ClaimRow[];
  pods: PodRow[];
  shipmentItems: ItemRow[];
  shipments: ShipmentRow[];
  variances: VarianceRow[];
}
const emptyView: View = {
  claims: [],
  pods: [],
  shipmentItems: [],
  shipments: [],
  variances: [],
};
const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['SHIPMENT_TRACKING'],
    id: 'confirmDelivery',
    label: '记录到达签收',
    requiredPermissions: ['tms.delivery.confirm'],
  },
  {
    allowedStatuses: ['SHIPMENT_DELIVERED'],
    id: 'submitPod',
    label: '提交 POD 元数据',
    requiredPermissions: ['tms.pod.submit'],
  },
  {
    allowedStatuses: ['POD_UPLOADED'],
    id: 'startReview',
    label: '开始 POD 审核',
    requiredPermissions: ['tms.pod.review'],
  },
  {
    allowedStatuses: ['POD_REVIEWING'],
    id: 'confirmPod',
    label: '确认 POD',
    requiredPermissions: ['tms.pod.review'],
  },
  {
    allowedStatuses: ['POD_REVIEWING'],
    id: 'returnPod',
    label: '退回 POD 补件',
    requiredPermissions: ['tms.pod.review'],
  },
  {
    allowedStatuses: ['VARIANCE_PENDING'],
    id: 'claim',
    label: '建立货损索赔',
    requiredPermissions: ['tms.claim.manage'],
  },
  {
    allowedStatuses: ['CLAIM_OPEN'],
    id: 'submitClaim',
    label: '提交索赔审批',
    requiredPermissions: ['tms.claim.manage'],
  },
  {
    allowedStatuses: ['CLAIM_PENDING_APPROVAL'],
    id: 'approveClaim',
    label: '批准并生成扣款事实',
    requiredPermissions: ['tms.claim.manage'],
  },
  {
    allowedStatuses: ['SHIPMENT_DELIVERED', 'SHIPMENT_POD'],
    id: 'createReturn',
    label: '生成逆向运输订单',
    requiredPermissions: ['tms.return.manage'],
  },
]);

export function DeliveryReversePanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [shipmentId, setShipmentId] = useState('');
  const [podId, setPodId] = useState('');
  const [varianceId, setVarianceId] = useState('');
  const [claimId, setClaimId] = useState('');
  const [fileId, setFileId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.delivery.read',
              'tms.delivery.confirm',
              'tms.pod.submit',
              'tms.pod.review',
              'tms.claim.manage',
              'tms.return.manage',
              'platform.attachment.read',
            ]
          : [],
      ),
    [claims],
  );
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const pod = view.pods.find(({ id }) => id === podId);
  const variance = view.variances.find(({ id }) => id === varianceId);
  const claim = view.claims.find(({ id }) => id === claimId);
  const decisions = actions
    .list()
    .map(({ id }) =>
      actions.decide(id, {
        dataScopeAllowed: true,
        permissions,
        status: ['startReview', 'confirmPod', 'returnPod'].includes(id)
          ? `POD_${pod?.status ?? 'NONE'}`
          : id === 'claim'
            ? `VARIANCE_${variance?.status ?? 'NONE'}`
            : ['submitClaim', 'approveClaim'].includes(id)
              ? `CLAIM_${claim?.status ?? 'NONE'}`
              : `SHIPMENT_${shipment?.status ?? 'NONE'}`,
      }),
    );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用签收与逆向工作台');
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
      const [operations, attachments] = await Promise.all([
        request('/api/v1/tms/delivery/workbench'),
        request(
          '/api/v1/platform/attachments?status=AVAILABLE&page=1&pageSize=100',
        ),
      ]);
      setView(operations as unknown as View);
      setFiles(
        ((attachments as { items?: FileRow[] }).items ?? []).filter(
          ({ scanStatus }) => scanStatus === 'CLEAN',
        ),
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '签收与逆向查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    try {
      if (actionId === 'confirmDelivery' && shipment) {
        const now = Date.now();
        const lines = view.shipmentItems
          .filter((item) => item.shipmentId === shipment.id)
          .map((item) => ({
            damagedQuantityBase: '0',
            deliveredQuantityBase: item.quantityBase,
            evidenceSnapshot: {},
            reason: '工作台签收数量一致',
            refusedQuantityBase: '0',
            shipmentItemId: item.id,
          }));
        if (!lines.length) throw new Error('运单缺少可签收明细');
        await request(`/api/v1/tms/delivery/shipments/${shipment.id}/confirm`, {
          body: JSON.stringify({
            arrivedAt: new Date(now).toISOString(),
            deliveryLocationSnapshot: { source: 'CONTROL_TOWER' },
            expectedShipmentVersion: shipment.version,
            lines,
            recipientName: '客户收货人',
            recipientSnapshot: { role: 'CUSTOMER' },
            signatureSnapshot: { signed: true },
            signedAt: new Date(now + 30 * 60_000).toISOString(),
            unloadingCompletedAt: new Date(now + 25 * 60_000).toISOString(),
            unloadingStartedAt: new Date(now + 5 * 60_000).toISOString(),
          }),
          method: 'POST',
        });
      } else if (actionId === 'submitPod' && shipment) {
        if (!fileId) throw new Error('请先选择已上传且病毒扫描通过的附件');
        await request(`/api/v1/tms/delivery/shipments/${shipment.id}/pod`, {
          body: JSON.stringify({
            fileObjectIds: [fileId],
            pageCount: 1,
            signatureSnapshot: { signed: true },
          }),
          method: 'POST',
        });
      } else if (
        ['startReview', 'confirmPod', 'returnPod'].includes(actionId) &&
        pod
      ) {
        const decision =
          actionId === 'startReview'
            ? 'START'
            : actionId === 'confirmPod'
              ? 'CONFIRM'
              : 'RETURN';
        await request(`/api/v1/tms/delivery/pods/${pod.id}/review`, {
          body: JSON.stringify({
            checkSnapshot:
              actionId === 'confirmPod'
                ? {
                    clarityConfirmed: true,
                    signatureConfirmed: true,
                    signedTimeConfirmed: true,
                    varianceAcknowledged: true,
                  }
                : {},
            decision,
            expectedVersion: pod.version,
            reason:
              actionId === 'returnPod'
                ? '回单页面或签名需要补充'
                : '工作台审核处理',
          }),
          method: 'POST',
        });
      } else if (actionId === 'claim' && variance) {
        if (
          !fileId ||
          !['DAMAGE', 'SHORTAGE', 'REFUSAL'].includes(variance.type)
        )
          throw new Error('请选择货损/短少/拒收差异和证据附件');
        await request(
          `/api/v1/tms/delivery/shipments/${variance.shipmentId}/claims`,
          {
            body: JSON.stringify({
              claimedAmount: '500',
              claimantRef: 'DEMO-CUSTOMER',
              currency: 'CNY',
              deliveryVarianceId: variance.id,
              evidenceFileObjectIds: [fileId],
              liabilitySnapshot: { proposed: 'CARRIER' },
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'submitClaim' && claim)
        await request(`/api/v1/tms/delivery/claims/${claim.id}/transition`, {
          body: JSON.stringify({
            action: 'SUBMIT',
            expectedVersion: claim.version,
            negotiationSnapshot: { source: 'WORKBENCH' },
          }),
          method: 'POST',
        });
      else if (actionId === 'approveClaim' && claim)
        await request(`/api/v1/tms/delivery/claims/${claim.id}/transition`, {
          body: JSON.stringify({
            action: 'APPROVE',
            approvalReference: 'WORKFLOW-DEMO',
            approvedAmount: claim.claimedAmount,
            expectedVersion: claim.version,
            negotiationSnapshot: { approved: true },
            responsiblePartyRef: 'DEMO-CARRIER',
          }),
          method: 'POST',
        });
      else if (actionId === 'createReturn' && shipment) {
        const now = Date.now();
        await request(`/api/v1/tms/delivery/shipments/${shipment.id}/returns`, {
          body: JSON.stringify({
            deliveryWindowTo: new Date(now + 12 * 3_600_000).toISOString(),
            itemSnapshot: [{ reason: '工作台逆向需求' }],
            pickupWindowFrom: new Date(now + 8 * 3_600_000).toISOString(),
            reason: '客户退货或周转箱返程',
            type: 'RETURN_GOODS',
          }),
          method: 'POST',
        });
      }
      setNotice('签收、POD、索赔或逆向动作已完成，原始事实和审核历史已保留');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '签收与逆向动作失败');
    }
  }
  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    setSelectedId: (id: string) => void,
    columns: readonly {
      key: keyof T & string;
      label: string;
      render?: (value: unknown) => ReactNode;
    }[],
  ) => (
    <DataGrid
      columns={columns}
      onPageChange={() => undefined}
      onSelectionChange={(ids) => setSelectedId(ids.at(-1) ?? '')}
      page={1}
      pageSize={200}
      rows={rows}
      selectedIds={selectedId ? [selectedId] : []}
      total={rows.length}
    />
  );
  return (
    <Card title="到达签收、POD、索赔与逆向运输">
      <Typography.Paragraph>
        签收差异逐运单项回写 OMS/WMS；POD 原件来自对象存储，退回补件期间运单保持
        Delivered，只有审核 Confirmed 才进入 POD 并允许后续结算。
      </Typography.Paragraph>
      <Space wrap>
        <Tag color="blue">对象存储原件</Tag>
        <Tag color="orange">Returned 禁止结算</Tag>
        <Tag color="red">扣款追加事实</Tag>
        <Tag color="purple">逆向复用运输池</Tag>
      </Space>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="签收与 POD 审核">
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.pods, podId, setPodId, [
              { key: 'podNo', label: 'POD 号' },
              { key: 'pageCount', label: '页数' },
              { key: 'status', label: '审核状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(files, fileId, setFileId, [
              { key: 'originalName', label: 'Clean 附件' },
              { key: 'scanStatus', label: '扫描' },
              { key: 'status', label: '文件状态' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="差异、索赔扣款与返程">
            {grid(view.variances, varianceId, setVarianceId, [
              { key: 'type', label: '差异类型' },
              { key: 'differenceQuantityBase', label: '数量差' },
              { key: 'baseUom', label: '单位' },
              { key: 'status', label: '状态' },
            ])}
            {grid(view.claims, claimId, setClaimId, [
              { key: 'claimNo', label: '索赔号' },
              { key: 'claimedAmount', label: '金额' },
              { key: 'currency', label: '币种' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
          </Card>
        </Col>
      </Row>
    </Card>
  );
}

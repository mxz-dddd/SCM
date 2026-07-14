import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommandBar, DataGrid, createActionRegistry } from '@scm/ui';
import { Alert, Card, Col, Row } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowBase {
  id: string;
  status: string;
  version: number;
}
interface ShipmentRow extends RowBase {
  deliveryWindowTo: string;
  pickupWindowFrom: string;
  shipmentNo: string;
}
interface AssignmentRow extends RowBase {
  assignmentNo: string;
  driverRef: string;
  shipmentId: string;
  vehicleRef: string;
}
interface TenderRow extends RowBase {
  shipmentId: string;
}
interface CheckRow extends RowBase {
  checkNo: string;
  failureReasons: string[];
  vehicleAssignmentId: string;
}
interface VehicleRow extends RowBase {
  plateNumber: string;
}
interface DriverRow extends RowBase {
  driverNo: string;
  name: string;
}
interface View {
  assignments: AssignmentRow[];
  checks: CheckRow[];
  dispatches: RowBase[];
  exceptions: RowBase[];
  fleetCandidates: {
    certificates: RowBase[];
    drivers: DriverRow[];
    vehicles: VehicleRow[];
  };
  shipments: ShipmentRow[];
  tenders: TenderRow[];
}

const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['SHIPMENT_ACCEPTED'],
    id: 'assign',
    label: '指派车辆司机',
    requiredPermissions: ['tms.dispatch.assign'],
  },
  {
    allowedStatuses: ['ASSIGNMENT_ASSIGNED'],
    confirmMessage: '撤销后运单恢复已接单，可重新选择车辆和司机。',
    id: 'revoke',
    label: '撤销派车',
    requiredPermissions: ['tms.dispatch.assign'],
  },
  {
    allowedStatuses: ['ASSIGNMENT_ASSIGNED'],
    id: 'compliance',
    label: '执行发运证照检查',
    requiredPermissions: ['tms.dispatch.compliance'],
  },
  {
    allowedStatuses: ['ASSIGNMENT_ASSIGNED'],
    confirmMessage: '确认装车、封签、单据和证照均满足并进入在途跟踪？',
    id: 'dispatch',
    label: '确认发运进入跟踪',
    requiredPermissions: ['tms.dispatch.confirm'],
  },
]);

const emptyView: View = {
  assignments: [],
  checks: [],
  dispatches: [],
  exceptions: [],
  fleetCandidates: { certificates: [], drivers: [], vehicles: [] },
  shipments: [],
  tenders: [],
};

export function DispatchPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [shipmentId, setShipmentId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.dispatch.read',
              'tms.dispatch.assign',
              'tms.dispatch.compliance',
              'tms.dispatch.confirm',
            ]
          : [],
      ),
    [claims],
  );
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const assignment = view.assignments.find(({ id }) => id === assignmentId);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status:
        id === 'assign'
          ? `SHIPMENT_${shipment?.status ?? 'NONE'}`
          : `ASSIGNMENT_${assignment?.status ?? 'NONE'}`,
    }),
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用派车发运工作台');
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
        (await request('/api/v1/tms/dispatch/workbench')) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '派车发运查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (
      !decision?.enabled ||
      (decision.confirmMessage && !window.confirm(decision.confirmMessage))
    )
      return;
    try {
      if (actionId === 'assign' && shipment) {
        const tender = view.tenders.find(
          (row) => row.shipmentId === shipment.id && row.status === 'ACCEPTED',
        );
        if (!tender || !vehicleId || !driverId)
          throw new Error('请选择已接单运单、可用车辆和司机');
        await request(`/api/v1/tms/dispatch/shipments/${shipment.id}/assign`, {
          body: JSON.stringify({
            backupContactSnapshot: { name: '调度值班', phone: '400-000-0000' },
            carrierTenderId: tender.id,
            driverRef: driverId,
            expectedShipmentVersion: shipment.version,
            scheduleFrom: new Date(
              new Date(shipment.pickupWindowFrom).getTime() - 3_600_000,
            ).toISOString(),
            scheduleTo: new Date(
              new Date(shipment.deliveryWindowTo).getTime() + 3_600_000,
            ).toISOString(),
            vehicleRef: vehicleId,
          }),
          method: 'POST',
        });
      } else if (actionId === 'revoke' && assignment)
        await request(
          `/api/v1/tms/dispatch/assignments/${assignment.id}/revoke`,
          {
            body: JSON.stringify({
              expectedVersion: assignment.version,
              reason: '工作台重新指派车辆司机',
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'compliance' && assignment) {
        const validFrom = new Date(Date.now() - 86_400_000).toISOString();
        const validUntil = new Date(
          Date.now() + 365 * 86_400_000,
        ).toISOString();
        await request(
          `/api/v1/tms/dispatch/assignments/${assignment.id}/compliance-checks`,
          {
            body: JSON.stringify({
              expectedAssignmentVersion: assignment.version,
              vehicleDocuments: [
                'VEHICLE_REGISTRATION',
                'VEHICLE_INSURANCE',
                'VEHICLE_INSPECTION',
                'VEHICLE_HAZMAT',
              ].map((type) => ({
                documentNo: `${type}-DEMO`,
                status: 'ACTIVE',
                type,
                validFrom,
                validUntil,
              })),
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'dispatch' && assignment) {
        const check = view.checks.find(
          (row) =>
            row.vehicleAssignmentId === assignment.id &&
            row.status === 'PASSED',
        );
        const assignedShipment = view.shipments.find(
          ({ id }) => id === assignment.shipmentId,
        );
        if (!check || !assignedShipment)
          throw new Error('缺少当前通过的证照检查');
        await request(
          `/api/v1/tms/dispatch/shipments/${assignment.shipmentId}/confirm`,
          {
            body: JSON.stringify({
              actualDepartureAt: new Date().toISOString(),
              complianceCheckId: check.id,
              documentSnapshot: { complete: true, handover: true },
              expectedAssignmentVersion: assignment.version,
              expectedShipmentVersion: assignedShipment.version,
              loadSnapshot: { loaded: true },
              sealSnapshot: { sealNo: `SEAL-${Date.now()}`, sealed: true },
              vehicleAssignmentId: assignment.id,
            }),
            method: 'POST',
          },
        );
      }
      setNotice('派车、证照或发运动作已完成，状态与跟踪事件已保存');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '派车发运动作失败');
    }
  }

  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    setSelectedId: (id: string) => void,
    columns: readonly { key: keyof T & string; label: string }[],
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
    <Card title="车辆司机指派、证照与发运确认">
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="Accepted→Dispatched 资源排班">
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.assignments, assignmentId, setAssignmentId, [
              { key: 'assignmentNo', label: '派车单号' },
              { key: 'vehicleRef', label: '车辆' },
              { key: 'driverRef', label: '司机' },
              { key: 'status', label: '状态' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="可用车队与 ComplianceCheck">
            {grid(view.fleetCandidates.vehicles, vehicleId, setVehicleId, [
              { key: 'plateNumber', label: '车牌' },
              { key: 'status', label: '车辆状态' },
            ])}
            {grid(view.fleetCandidates.drivers, driverId, setDriverId, [
              { key: 'driverNo', label: '司机编号' },
              { key: 'name', label: '姓名' },
              { key: 'status', label: '司机状态' },
            ])}
            {grid(view.checks, '', () => undefined, [
              { key: 'checkNo', label: '检查号' },
              { key: 'status', label: '检查结果' },
              { key: 'version', label: '版本' },
            ])}
          </Card>
        </Col>
      </Row>
    </Card>
  );
}

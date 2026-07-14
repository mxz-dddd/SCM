export interface AppointmentRequestCommand {
  correlationId: string;
  milestoneId: string;
  plannedAt: string;
  requestRef: string;
  shipmentId: string;
  siteRequirementSnapshot: Readonly<Record<string, unknown>>;
  tenantId: string;
}

export interface AppointmentChangeCommand {
  appointmentRef?: string;
  correlationId: string;
  linkId: string;
  plannedAt?: string;
  reason: string;
  requestRef: string;
  type: 'RESCHEDULE' | 'CANCEL';
}

/**
 * AMS 在 P3-11 起实现。本端口只定义 TMS 发出的命令契约；当前适配器为事务 Outbox，
 * 因此 TMS 不读取或修改 AMS 内部表，也不参与跨域事务。
 */
export interface AppointmentCommandPort {
  request(command: AppointmentRequestCommand): Promise<void>;
  requestChange(command: AppointmentChangeCommand): Promise<void>;
}

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';

export interface ChannelDeliveryRequest {
  readonly body: string;
  readonly channel: NotificationChannel;
  readonly notificationId: string;
  readonly recipientAccountId: string;
  readonly subject: string;
}

export interface ChannelDeliveryResult {
  readonly delivered: boolean;
  readonly errorCode?: string;
  readonly providerMessageId?: string;
  readonly retryable: boolean;
}

@Injectable()
export class NotificationChannelService {
  async deliver(
    request: ChannelDeliveryRequest,
  ): Promise<ChannelDeliveryResult> {
    if (request.channel === 'IN_APP') {
      return {
        delivered: true,
        providerMessageId: `in-app:${request.notificationId}`,
        retryable: false,
      };
    }
    const simulated = process.env.NOTIFICATION_CHANNEL_SIMULATION;
    if (simulated === 'success') {
      return {
        delivered: true,
        providerMessageId: `simulated:${randomUUID()}`,
        retryable: false,
      };
    }
    return {
      delivered: false,
      errorCode: 'CHANNEL_NOT_CONFIGURED',
      retryable: true,
    };
  }
}

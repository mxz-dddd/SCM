import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { PrismaService } from '../../../database/prisma.service';

function localParts(at: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(at)
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour === '24' ? '00' : values.hour}:${values.minute}`,
  };
}

@Injectable()
export class CalendarReleaseFacade {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async evaluate(
    calendarCode: string,
    resourceId: string,
    serviceType: string | undefined,
    at: Date,
    context: TenantContext,
  ) {
    const code = calendarCode.trim().toUpperCase();
    const candidates = await this.prisma.businessCalendar.findMany({
      orderBy: { versionNumber: 'desc' },
      where: { code, status: 'ACTIVE', tenantId: context.tenantId },
    });
    const calendar = candidates.find((item) => {
      const { date } = localParts(at, item.timeZone);
      const day = new Date(`${date}T00:00:00.000Z`);
      return (
        item.effectiveFrom <= day &&
        (!item.effectiveUntil || item.effectiveUntil >= day)
      );
    });
    if (!calendar)
      throw new AppError(
        'RELEASE_CALENDAR_NOT_ACTIVE',
        'Active release calendar was not found',
        404,
      );
    const local = localParts(at, calendar.timeZone);
    const day = new Date(`${local.date}T00:00:00.000Z`);
    const exception = await this.prisma.calendarDate.findFirst({
      where: {
        calendarId: calendar.id,
        date: day,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const working =
      exception?.working ??
      (calendar.workingDays as number[]).includes(day.getUTCDay());
    const window = await this.prisma.workingWindow.findFirst({
      where: {
        calendarId: calendar.id,
        resourceId,
        resourceType: 'WAREHOUSE',
        serviceType: serviceType?.trim().toUpperCase() ?? null,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const withinCutoff =
      working && (!window?.cutoffTime || local.time <= window.cutoffTime);
    return {
      calendarId: calendar.id,
      calendarVersion: calendar.versionNumber,
      cutoffTime: window?.cutoffTime ?? null,
      date: local.date,
      exceptionReason: exception?.reason ?? null,
      localTime: local.time,
      timeZone: calendar.timeZone,
      withinCutoff,
      working,
    };
  }

  async computeSlaDeadline(
    calendarCode: string,
    startedAt: Date,
    durationMinutes: number,
    warningLeadMinutes: number,
    context: TenantContext,
  ) {
    const code = calendarCode.trim().toUpperCase();
    const calendar = await this.prisma.businessCalendar.findFirst({
      orderBy: { versionNumber: 'desc' },
      where: { code, status: 'ACTIVE', tenantId: context.tenantId },
    });
    if (!calendar)
      throw new AppError(
        'SLA_CALENDAR_NOT_ACTIVE',
        'Active SLA calendar was not found',
        404,
      );
    let cursor = new Date(startedAt);
    let remaining = durationMinutes;
    let guard = 0;
    while (remaining > 0 && guard++ < 370) {
      const local = localParts(cursor, calendar.timeZone);
      const day = new Date(`${local.date}T00:00:00.000Z`);
      const exception = await this.prisma.calendarDate.findFirst({
        where: {
          calendarId: calendar.id,
          date: day,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const working =
        exception?.working ??
        (calendar.workingDays as number[]).includes(day.getUTCDay());
      const step = Math.min(remaining, 1_440);
      cursor = new Date(cursor.getTime() + (working ? step : 1_440) * 60_000);
      if (working) remaining -= step;
    }
    if (remaining > 0)
      throw new AppError(
        'SLA_CALENDAR_RANGE_EXCEEDED',
        'SLA deadline exceeds calendar range',
        409,
      );
    return {
      calendarSnapshot: {
        calendarId: calendar.id,
        calendarVersion: calendar.versionNumber,
        timeZone: calendar.timeZone,
        workingDays: calendar.workingDays,
      },
      dueAt: cursor,
      warningAt: new Date(
        Math.max(
          startedAt.getTime(),
          cursor.getTime() - warningLeadMinutes * 60_000,
        ),
      ),
    };
  }
}

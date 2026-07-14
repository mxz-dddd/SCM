import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { isUuid } from '../../../common/validation';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AttachmentReferenceFacade {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async inspectAvailable(
    fileObjectIds: readonly string[],
    context: TenantContext,
  ) {
    const ids = [...new Set(fileObjectIds)];
    if (!ids.length || ids.some((id) => !isUuid(id)))
      throw new AppError(
        'ATTACHMENT_REFERENCE_INVALID',
        'At least one valid file object is required',
        400,
      );
    const files = await this.prisma.fileObject.findMany({
      orderBy: { id: 'asc' },
      select: {
        checksumSha256: true,
        contentType: true,
        contentVersion: true,
        id: true,
        originalName: true,
        sizeBytes: true,
      },
      where: {
        id: { in: ids },
        scanStatus: 'CLEAN',
        status: 'AVAILABLE',
        tenantId: context.tenantId,
      },
    });
    if (files.length !== ids.length)
      throw new AppError(
        'ATTACHMENT_REFERENCE_NOT_AVAILABLE',
        'Every referenced file must be uploaded, available and virus-scan clean',
        409,
      );
    return files.map((file) => ({
      ...file,
      sizeBytes: file.sizeBytes.toString(),
    }));
  }
}

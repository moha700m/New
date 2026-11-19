import "server-only";
import { prisma } from "./db";

export async function audit(
  actor: { id: string; email: string } | null,
  action: string,
  opts: { entityType?: string; entityId?: string; details?: Record<string, unknown>; ip?: string } = {},
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        actorEmail: actor?.email,
        action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        details: (opts.details ?? undefined) as object | undefined,
        ip: opts.ip,
      },
    });
  } catch (e) {
    console.error("[audit] failed to write audit log", e);
  }
}

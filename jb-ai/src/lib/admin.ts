import "server-only";
import { audit } from "./audit";
import { requireAdmin, type SafeUser } from "./auth";
import { bumpConfigVersion } from "./config-bus";
import { clientIp, handler } from "./http";

export type AdminCtx<P = Record<string, string>> = {
  user: SafeUser;
  params: P;
  req: Request;
  /** Write an audit log entry for this admin action. */
  log: (action: string, opts?: { entityType?: string; entityId?: string; details?: Record<string, unknown> }) => Promise<void>;
  /** Publish a live configuration change to all clients and server instances. */
  publish: () => Promise<number>;
};

/** Wrap an admin route: server-side role check, audit helper, live-config publisher, error handling. */
export function adminRoute<P = Record<string, string>>(fn: (ctx: AdminCtx<P>) => Promise<Response>) {
  return handler(async (req: Request, routeCtx: { params: Promise<P> }) => {
    const user = await requireAdmin();
    const params = (routeCtx?.params ? await routeCtx.params : {}) as P;
    const ip = clientIp(req);
    return fn({
      user,
      params,
      req,
      log: (action, opts = {}) => audit({ id: user.id, email: user.email }, action, { ...opts, ip }),
      publish: bumpConfigVersion,
    });
  });
}

export function redactProvider<T extends { apiKeyEncrypted: string | null }>(p: T) {
  const { apiKeyEncrypted, ...rest } = p;
  return { ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
}

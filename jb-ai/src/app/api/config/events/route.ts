import { currentVersion, ensureBusStarted, onConfigChange, readVersion } from "@/lib/config-bus";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-Sent Events stream of configuration versions. Clients refetch /api/config when the version changes.
 * The stream closes after ~5 minutes; EventSource reconnects automatically (also works on platforms with request timeouts).
 */
export async function GET(req: Request) {
  ensureBusStarted();
  const initial = currentVersion() || (await readVersion());
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (s: string) => {
        try {
          ctrl.enqueue(encoder.encode(s));
        } catch {}
      };
      send(`retry: 3000\nevent: version\ndata: ${initial}\n\n`);
      const off = onConfigChange((v) => send(`event: version\ndata: ${v}\n\n`));
      const ping = setInterval(() => send(`: ping\n\n`), 20000);
      const end = setTimeout(() => {
        cleanup();
        try {
          ctrl.close();
        } catch {}
      }, 290_000);
      cleanup = () => {
        off();
        clearInterval(ping);
        clearTimeout(end);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          ctrl.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

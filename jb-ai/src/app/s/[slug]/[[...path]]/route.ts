import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", xml: "application/xml", webmanifest: "application/manifest+json",
};

/**
 * Serves agent-published static sites. The sandbox CSP gives every page an opaque origin, so a published page can
 * never read this app's cookies or call its API as the signed-in owner.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path } = await ctx.params;
  const url = new URL(req.url);
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site) return new NextResponse("الموقع غير موجود", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const files = site.files as Record<string, string>;
  let p = (path ?? []).map(decodeURIComponent).join("/") || "index.html";
  if (!(p in files) && `${p}/index.html` in files) p = `${p}/index.html`;
  if (!(p in files) && `${p}.html` in files) p = `${p}.html`;
  const body = files[p] ?? files["404.html"];
  if (body == null) return new NextResponse("Not found", { status: 404 });
  const ext = (p in files ? p : "404.html").split(".").pop()!.toLowerCase();
  const bin = /^base64:([\w.+-]+\/[\w.+-]+):/.exec(body);
  // Next strips trailing slashes, so relative links resolve against /s/: pin them with a <base> tag
  let out: string | Buffer = body;
  if (!bin && (ext === "html" || ext === "htm") && !/<base\s/i.test(body)) {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
    const tag = `<base href="/s/${slug}/${dir}">`;
    out = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + tag) : tag + body;
  }
  return new NextResponse(bin ? Buffer.from(body.slice(bin[0].length), "base64") : out, {
    status: p in files ? 200 : 404,
    headers: {
      "Content-Type": bin ? (bin[1].startsWith("image/") && bin[1] !== "image/svg+xml" ? bin[1] : "application/octet-stream") : TYPES[ext] ?? "text/plain; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

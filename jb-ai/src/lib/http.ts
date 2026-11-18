import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function json<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
  if (err instanceof ZodError) {
    return json({ error: "بيانات غير صالحة: " + err.issues.map(zodIssueAr).join("؛ "), code: "validation" }, 400);
  }
  console.error("[api] unhandled error", err);
  return json({ error: "خطأ داخلي في الخادم" }, 500);
}

function zodIssueAr(i: ZodError["issues"][number]): string {
  const field = i.path.join(".");
  const label = ({ email: "البريد الإلكتروني", password: "كلمة المرور", name: "الاسم", title: "العنوان" } as Record<string, string>)[field] ?? field;
  let msg = i.message;
  if (/[\u0600-\u06FF]/.test(msg)) return msg; // already Arabic (custom message)
  if (i.code === "invalid_string" && i.validation === "email") msg = "صيغة البريد الإلكتروني غير صحيحة";
  else if (i.code === "invalid_string" && i.validation === "url") msg = "الرابط غير صحيح";
  else if (i.code === "too_small") msg = `قصير جدًا (الحد الأدنى ${String(i.minimum)})`;
  else if (i.code === "too_big") msg = `طويل جدًا (الحد الأقصى ${String(i.maximum)})`;
  else if (i.code === "invalid_type") msg = "قيمة مفقودة أو غير صحيحة";
  else if (i.code === "invalid_enum_value") msg = "قيمة غير مسموحة";
  return label ? `${label}: ${msg}` : msg;
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw new HttpError(400, "صيغة الطلب غير صحيحة");
  }
  return schema.parse(data);
}

/** Wrap a route handler so thrown HttpErrors / ZodErrors become JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

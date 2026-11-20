"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-bold text-white">حدث خطأ غير متوقع</h1>
      <p className="text-sm text-white/50">تعذّر تحميل الصفحة من خوادم Agentsii. يرجى المحاولة مرة أخرى.</p>
      <button onClick={reset} className="btn-primary">إعادة المحاولة</button>
    </main>
  );
}

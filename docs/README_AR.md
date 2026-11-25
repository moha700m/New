# Agentsii Codex Manager

برنامج سطح مكتب لنظام Windows يربط **OpenAI Codex** بأي مزود ذكاء اصطناعي تختاره — DeepSeek وOpenRouter وVenice AI وShannon AI أو أي API متوافق مع OpenAI — بدون Terminal وبدون تعديل `config.toml` يدوياً.

- **الإصدار:** 1.0.0
- **النظام:** Windows 10 (1809 أو أحدث) و Windows 11 — ‏64-bit
- **الهوية:** Agentsii — واجهة داكنة احترافية، الإنجليزية افتراضياً مع دعم كامل للعربية (RTL)

---

## ماذا يفعل البرنامج؟

1. يكتشف تثبيت Codex (‏CLI، تطبيق سطح المكتب، إضافة VS Code) ومسار `CODEX_HOME` وملف `config.toml`.
2. يقرأ إعداداتك الحالية **ويحتفظ بها كما هي** (حتى التعليقات والتنسيق).
3. يأخذ **نسخة احتياطية** تلقائية قبل أي تعديل، ويكتب الملف بشكل ذرّي ثم يتحقق منه، ويستعيد النسخة إذا فشل التحقق.
4. يضيف قسم `[model_providers.<id>]` للمزود، ويضبط الموديل الافتراضي عند طلبك.
5. يضبط المصادقة بطريقة Codex الرسمية **دون وضع المفتاح في الملف**.
6. يتحقق فعلياً من أن Codex يستطيع جلب المفتاح، ويعرض النتيجة بصدق (لا يدّعي النجاح إن فشل أي فحص).

## كيف تتم المصادقة بأمان؟

- يُحفظ مفتاح API في **Windows Credential Manager** فقط (محمي بـ DPAPI ومرتبط بحساب المستخدم).
- يكتب البرنامج في `config.toml` آلية Codex الرسمية للمصادقة بالأوامر:

```toml
[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"

[model_providers.openrouter.auth]
command = 'C:\Users\<you>\AppData\Local\Agentsii\CodexManager\bin\agentsii-helper.exe'
args = ["token", "openrouter"]
timeout_ms = 15000
refresh_interval_ms = 0
```

عند الحاجة يشغّل Codex البرنامج المساعد `agentsii-helper.exe` الذي يقرأ المفتاح من Credential Manager ويطبعه لـ Codex مباشرة. المفتاح لا يُكتب في `config.toml` ولا في السجلات ولا في ملفات التصدير أو النسخ الاحتياطية، ولا يُرسل إلى Agentsii أبداً.

## مزودات Chat Completions (مثل DeepSeek وVenice)

إصدارات Codex الحالية تدعم **Responses API فقط** (أُزيل دعم `wire_api = "chat"` في 2026). لذلك:

- إذا كان المزود يدعم Responses API ← يتصل Codex به **مباشرة**.
- إذا كان يدعم Chat Completions فقط ← يمر الاتصال عبر **جسر Agentsii** (Agentsii Bridge): خادم صغير يعمل على `127.0.0.1` فقط داخل جهازك، يحوّل طلبات Codex من Responses إلى Chat Completions ويعيد الردود بالتنسيق الذي يفهمه Codex، بما في ذلك البث (streaming) واستدعاء الأدوات (tool calling) ونص التفكير (`reasoning_content` المطلوب من DeepSeek).
- الجسر يعمل تلقائياً عندما يحتاجه Codex، ومحمي بـ token عشوائي خاص بجهازك، ويرفض أي طلب من المتصفح.
- طريقة "Custom header" (مثل `X-API-Key`) تمر أيضاً عبر الجسر لأن Codex يرسل `Authorization: Bearer` فقط.

> البرنامج لا يكتب أي إعداد غير مدعوم أو تجريبي على أنه مستقر: يكتب فقط `wire_api = "responses"` و `[auth]` الموثقين رسمياً.

## الصفحات

| الصفحة | الوظيفة |
|---|---|
| Dashboard | حالة Codex والمزودات والجسر |
| Add Provider | إضافة/تعديل مزود + اكتشاف البروتوكول وجلب الموديلات |
| My Providers | ربط/فصل/تعيين افتراضي/اختبار/حذف |
| Model Settings | إدارة موديلات كل مزود وتغيير الموديل الافتراضي في Codex |
| Connection Test | فحص الرابط والمفتاح والموديل والبروتوكول والبث واستدعاء الأدوات + "التحقق عبر Codex" الفعلي |
| Backup & Restore | نسخ config.toml التلقائية، نسخة كاملة، تصدير/استيراد المزودات بدون مفاتيح |
| Settings | اللغة، مجلد Codex، منفذ الجسر، التحديثات |
| About Agentsii | معلومات الإصدار والخصوصية |

## الخصوصية

- كل البيانات تبقى على جهاز العميل: `%APPDATA%\Agentsii\CodexManager` و `%LOCALAPPDATA%\Agentsii\CodexManager`.
- لا قاعدة بيانات سحابية، ولا Telemetry.
- الاتصالات الوحيدة: المزودات التي يضيفها العميل، وملف الإصدار `latest.json` للتحقق من التحديثات (يمكن إيقافه من الإعدادات).

## التحديثات

يقرأ البرنامج ملف `latest.json` من صفحة التحميل. عند وجود إصدار أحدث يعرض ذلك للمستخدم، وبعد موافقته ينزّل المثبّت عبر HTTPS ويتحقق من **SHA-256** قبل تشغيله. إعدادات العميل ومفاتيحه محفوظة خارج مجلد البرنامج فلا تتأثر بالتحديث.

لإصدار تحديث: غيّر `VERSION` في `src/agentsii_cm/version.py` ← ابنِ ← ارفع الملفات ← حدّث `latest.json` (يولّده سكربت البناء مع الـ checksums).

## البنية التقنية

```
src/agentsii_cm/
  models.py, store.py        نموذج المزود والتخزين (بدون أسرار)
  keystore.py                Windows Credential Manager عبر keyring
  codex_detect.py            اكتشاف Codex و CODEX_HOME
  codex_config.py            تعديل config.toml بأمان (tomlkit) + نسخ احتياطي + تحقق
  bridge/translate.py        تحويل Responses ⇄ Chat Completions
  bridge/server.py           جسر Agentsii المحلي
  helper_cli.py              agentsii-helper.exe (أمر المصادقة لـ Codex)
  tester.py                  اختبار الاتصال + التحقق عبر Codex CLI
  updater.py, backup.py      التحديثات والنسخ الاحتياطي
  core.py                    طبقة الخدمات
  ui/                        واجهة PySide6 (8 صفحات، EN/AR)
packaging/                   PyInstaller + Inno Setup + أيقونة + تحقق ما بعد البناء
tests/                       64 اختباراً (pytest) تشمل مزوداً وهمياً واختباراً شاملاً للجسر
```

التقنيات: Python 3.12، PySide6، TOMLKit، Keyring، HTTPX، Truststore، PyInstaller، Inno Setup، Pytest.

## البناء

- **تلقائياً:** ملف `.github/workflows/build-windows.yml` يبني على Windows Runner ويشغّل الاختبارات، ثم يتحقق من الملفات المبنية على Windows حقيقي (Credential Manager، الجسر، و Codex CLI الحقيقي مع مزود تجريبي).
- **محلياً على Windows:** ثبّت Python 3.12 و Inno Setup 6 ثم انقر مرتين على `build_windows.bat`.

الناتج في `dist\release\`:
- `AgentsiiCodexManager-Setup-1.0.0.exe` — مثبّت (بدون صلاحيات مدير)
- `AgentsiiCodexManager-Portable-1.0.0.exe` — نسخة محمولة بملف واحد
- `SHA256SUMS.txt` و `latest.json`

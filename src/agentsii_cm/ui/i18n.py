"""UI strings: English (default) and Arabic (RTL)."""
from __future__ import annotations

_lang = "en"

EN: dict[str, str] = {
    "app.tagline": "Connect any AI provider to OpenAI Codex",
    "nav.dashboard": "Dashboard", "nav.add": "Add Provider", "nav.providers": "My Providers",
    "nav.models": "Model Settings", "nav.test": "Connection Test", "nav.backup": "Backup & Restore",
    "nav.settings": "Settings", "nav.about": "About Agentsii",
    "common.save": "Save", "common.cancel": "Cancel", "common.delete": "Delete", "common.edit": "Edit",
    "common.yes": "Yes", "common.no": "No", "common.close": "Close", "common.ok": "OK", "common.refresh": "Refresh",
    "common.working": "Working…", "common.error": "Error", "common.success": "Success", "common.warning": "Warning",
    "common.none": "None", "common.open_folder": "Open folder", "common.copy": "Copy",
    # dashboard
    "dash.title": "Dashboard", "dash.subtitle": "Status of Codex and your providers on this computer.",
    "dash.codex": "Codex", "dash.codex_cli": "Codex CLI", "dash.not_found": "Not found",
    "dash.desktop": "Codex desktop app", "dash.ide": "IDE extension", "dash.found": "Detected",
    "dash.codex_home": "CODEX_HOME", "dash.config": "config.toml", "dash.exists": "exists",
    "dash.missing": "will be created",
    "dash.default": "Default in Codex", "dash.default_none": "Codex is using its own default (no Agentsii provider).",
    "dash.providers": "Providers", "dash.connected": "connected to Codex", "dash.saved": "saved",
    "dash.bridge": "Agentsii Bridge", "dash.bridge_running": "Running", "dash.bridge_stopped": "Not running",
    "dash.bridge_hint": "Needed for Chat-Completions providers. It starts automatically when Codex needs it.",
    "dash.start_bridge": "Start bridge", "dash.stop_bridge": "Stop bridge",
    "dash.quick": "Quick actions", "dash.add_first": "Add your first provider",
    "dash.no_codex_hint": "Codex was not detected. You can still prepare providers now; install Codex from "
                          "OpenAI and they will work immediately.",
    "dash.update_available": "Version {v} is available.", "dash.update_now": "Update",
    # add provider
    "add.title": "Add Provider", "add.edit_title": "Edit Provider",
    "add.subtitle": "Enter your provider's details. Your API key is stored in Windows Credential Manager.",
    "add.preset": "Provider", "add.preset_custom": "Other OpenAI-compatible provider",
    "add.name": "Provider Name", "add.id": "Provider ID", "add.id_hint": "Used in config.toml (lowercase, no spaces).",
    "add.base_url": "API Base URL", "add.base_url_hint": "Usually ends with /v1 — copy it from your provider's docs.",
    "add.api_key": "API Key", "add.api_key_keep": "Leave empty to keep the saved key",
    "add.show": "Show", "add.hide": "Hide",
    "add.model": "Model ID", "add.models_extra": "Additional models (optional)",
    "add.models_extra_hint": "One model ID per line or comma-separated.",
    "add.wire": "API Protocol (Wire API)", "add.wire_responses": "Responses API",
    "add.wire_chat": "Chat Completions",
    "add.wire_hint_chat": "Codex itself only speaks the Responses API. Chat Completions providers are connected "
                          "through the built-in Agentsii Bridge (runs locally on this PC).",
    "add.wire_hint_responses": "Codex connects to this provider directly.",
    "add.auth": "Authentication", "add.auth_bearer": "API key — Authorization: Bearer",
    "add.auth_header": "API key — custom header", "add.auth_none": "No authentication (local server)",
    "add.header_name": "Header name",
    "add.default": "Set as default in Codex",
    "add.detect": "Auto-detect protocol", "add.fetch_models": "Fetch models",
    "add.save": "Save", "add.save_connect": "Save & Connect to Codex",
    "add.saved": "Provider saved.", "add.detecting": "Checking which protocols the provider supports…",
    "add.detect_result": "Responses API: {r}   •   Chat Completions: {c}",
    "add.detect_none": "Neither protocol answered. Check the URL, key and model ID.",
    "add.fetched": "{n} models found.", "add.supported": "supported", "add.unsupported": "not available",
    "add.need_url_key": "Enter the Base URL, model ID and API key first.",
    # providers
    "prov.title": "My Providers", "prov.subtitle": "Manage, connect and test your saved providers.",
    "prov.col_name": "Name", "prov.col_id": "ID", "prov.col_protocol": "Protocol", "prov.col_model": "Default model",
    "prov.col_status": "Codex", "prov.col_key": "Key",
    "prov.connected": "Connected", "prov.not_connected": "Not connected", "prov.default": "Default",
    "prov.key_ok": "Saved", "prov.key_missing": "Missing", "prov.key_na": "—",
    "prov.connect": "Connect to Codex", "prov.disconnect": "Disconnect", "prov.set_default": "Set as default",
    "prov.test": "Test", "prov.empty": "No providers yet. Click “Add Provider” to start.",
    "prov.confirm_delete": "Delete provider “{name}”? Its key is removed from Credential Manager and its "
                           "entry is removed from Codex's config.toml (a backup is kept).",
    "prov.connect_ok": "Connected to Codex.", "prov.connect_fail": "Connection to Codex failed",
    "prov.conflict": "Your config.toml already has a provider named “{id}” that Agentsii did not create. "
                     "Replace it? (A backup is created first.)",
    "prov.disconnected": "Removed from Codex. Your previous Codex settings were restored.",
    "prov.restart_codex": "Restart Codex (or open a new session) to use the new settings.",
    # models
    "models.title": "Model Settings", "models.subtitle": "Choose the provider and model Codex uses by default.",
    "models.provider": "Provider", "models.list": "Models", "models.add": "Add model",
    "models.remove": "Remove selected", "models.make_default": "Use selected model in Codex",
    "models.placeholder": "model ID, e.g. deepseek-chat", "models.applied": "Codex now uses {m} on {p}.",
    "models.saved_only": "Saved. Connect the provider to Codex to apply it.",
    "models.current": "Codex default now: {v}",
    # test
    "test.title": "Connection Test",
    "test.subtitle": "Checks URL, key, model, protocol, streaming and tool calling.",
    "test.run": "Test API Connection", "test.codex": "Verify with Codex",
    "test.codex_hint": "Runs a real request through the Codex CLI using this provider (about 10–60 s).",
    "test.no_cli": "Codex CLI not found — install it to run the end-to-end check.",
    "test.http_note": "Note: a successful HTTP test alone does not prove full Codex compatibility. "
                      "“Verify with Codex” is the final check.",
    "test.model": "Model", "test.running": "Testing…",
    "test.overall_pass": "All checks passed", "test.overall_warn": "Works with warnings",
    "test.overall_fail": "Problems found",
    "test.check.url": "Base URL", "test.check.auth": "API key", "test.check.model": "Model",
    "test.check.protocol": "Protocol & streaming", "test.check.tools": "Tool calling",
    "test.codex_ok": "Codex answered correctly through this provider.",
    "test.codex_fail": "Codex check failed", "test.not_connected": "Connect this provider to Codex first.",
    # backup
    "backup.title": "Backup & Restore",
    "backup.subtitle": "Automatic backups of config.toml are taken before every change. API keys are never "
                       "included in backups or exports.",
    "backup.auto": "config.toml backups", "backup.restore_sel": "Restore selected",
    "backup.confirm_restore": "Replace Codex's config.toml with the selected backup? The current file is backed up first.",
    "backup.restored": "Backup restored.", "backup.full": "Full backup",
    "backup.create": "Create backup file…", "backup.restore_file": "Restore from backup file…",
    "backup.created": "Backup saved to {p}", "backup.full_restored": "Restored. Re-enter API keys for providers marked “Missing”.",
    "backup.export": "Export providers (without keys)…", "backup.import": "Import providers…",
    "backup.exported": "Providers exported.", "backup.imported": "Imported {n} provider(s). Skipped {s} existing.",
    "backup.keys_note": "Imported providers need their API keys entered again (Edit provider).",
    # settings
    "set.title": "Settings", "set.language": "Language", "set.codex_home": "Codex folder (CODEX_HOME)",
    "set.codex_home_hint": "Leave empty to detect automatically.", "set.browse": "Browse…",
    "set.port": "Agentsii Bridge port", "set.updates": "Check for updates when the app starts",
    "set.updates_hint": "Only downloads a small version file; no personal data is sent.",
    "set.check_now": "Check for updates now", "set.up_to_date": "You have the latest version ({v}).",
    "set.update_found": "Version {v} is available.\n\n{notes}\n\nDownload and install now?",
    "set.downloading": "Downloading update…", "set.update_error": "Update check failed",
    "set.logs": "Open logs folder", "set.data": "Open app data folder", "set.saved": "Settings saved.",
    "set.privacy": "Privacy: all provider data and keys stay on this computer. No telemetry is collected.",
    "set.port_changed": "Port changed. Re-connect bridged providers so Codex uses the new port.",
    # about
    "about.title": "About Agentsii", "about.version": "Version {v}",
    "about.body": "Agentsii Codex Manager connects OpenAI Codex to the AI providers you choose — "
                  "DeepSeek, OpenRouter, Venice AI, Shannon AI or any OpenAI-compatible API — without terminals "
                  "or editing files by hand.",
    "about.privacy_title": "Your data stays yours",
    "about.privacy": "• API keys are stored only in Windows Credential Manager on this PC.\n"
                     "• Keys are never written to config.toml, logs, exports or backups.\n"
                     "• Nothing is sent to Agentsii. No telemetry.\n"
                     "• The app only contacts your providers (when you test or use them) and the update file.",
    "about.how_title": "How the connection works",
    "about.how": "Codex reads its settings from config.toml. Agentsii adds a [model_providers] entry whose "
                 "credential is fetched at run time by agentsii-helper.exe from Credential Manager (Codex's "
                 "official command-based authentication). Providers that only offer Chat Completions are "
                 "served by the Agentsii Bridge on 127.0.0.1, which translates to the Responses API Codex uses.",
    "about.download": "Download page",
}

AR: dict[str, str] = {
    "app.tagline": "اربط أي مزود ذكاء اصطناعي مع OpenAI Codex",
    "nav.dashboard": "لوحة التحكم", "nav.add": "إضافة مزود", "nav.providers": "مزوداتي",
    "nav.models": "إعدادات الموديل", "nav.test": "اختبار الاتصال", "nav.backup": "النسخ الاحتياطي",
    "nav.settings": "الإعدادات", "nav.about": "عن Agentsii",
    "common.save": "حفظ", "common.cancel": "إلغاء", "common.delete": "حذف", "common.edit": "تعديل",
    "common.yes": "نعم", "common.no": "لا", "common.close": "إغلاق", "common.ok": "موافق", "common.refresh": "تحديث",
    "common.working": "جارٍ التنفيذ…", "common.error": "خطأ", "common.success": "تم بنجاح", "common.warning": "تنبيه",
    "common.none": "لا يوجد", "common.open_folder": "فتح المجلد", "common.copy": "نسخ",
    "dash.title": "لوحة التحكم", "dash.subtitle": "حالة Codex والمزودات على هذا الجهاز.",
    "dash.codex": "Codex", "dash.codex_cli": "Codex CLI", "dash.not_found": "غير موجود",
    "dash.desktop": "تطبيق Codex لسطح المكتب", "dash.ide": "إضافة المحرر", "dash.found": "تم الاكتشاف",
    "dash.codex_home": "CODEX_HOME", "dash.config": "config.toml", "dash.exists": "موجود",
    "dash.missing": "سيتم إنشاؤه",
    "dash.default": "الافتراضي في Codex", "dash.default_none": "يستخدم Codex إعداده الافتراضي (لا يوجد مزود من Agentsii).",
    "dash.providers": "المزودات", "dash.connected": "مرتبط مع Codex", "dash.saved": "محفوظ",
    "dash.bridge": "جسر Agentsii", "dash.bridge_running": "يعمل", "dash.bridge_stopped": "متوقف",
    "dash.bridge_hint": "مطلوب لمزودات Chat Completions، ويعمل تلقائياً عندما يحتاجه Codex.",
    "dash.start_bridge": "تشغيل الجسر", "dash.stop_bridge": "إيقاف الجسر",
    "dash.quick": "إجراءات سريعة", "dash.add_first": "أضف أول مزود",
    "dash.no_codex_hint": "لم يتم العثور على Codex. يمكنك تجهيز المزودات الآن، وبعد تثبيت Codex من OpenAI ستعمل مباشرة.",
    "dash.update_available": "الإصدار {v} متاح.", "dash.update_now": "تحديث",
    "add.title": "إضافة مزود", "add.edit_title": "تعديل مزود",
    "add.subtitle": "أدخل بيانات المزود. يُحفظ مفتاح API في مدير بيانات الاعتماد في Windows.",
    "add.preset": "المزود", "add.preset_custom": "مزود آخر متوافق مع OpenAI",
    "add.name": "اسم المزود", "add.id": "معرّف المزود (Provider ID)", "add.id_hint": "يُستخدم في config.toml (حروف إنجليزية صغيرة بدون مسافات).",
    "add.base_url": "رابط API الأساسي (Base URL)", "add.base_url_hint": "ينتهي غالباً بـ ‎/v1‎ — انسخه من وثائق المزود.",
    "add.api_key": "مفتاح API", "add.api_key_keep": "اتركه فارغاً للإبقاء على المفتاح المحفوظ",
    "add.show": "إظهار", "add.hide": "إخفاء",
    "add.model": "معرّف الموديل (Model ID)", "add.models_extra": "موديلات إضافية (اختياري)",
    "add.models_extra_hint": "موديل في كل سطر أو مفصولة بفواصل.",
    "add.wire": "بروتوكول API ‏(Wire API)", "add.wire_responses": "Responses API",
    "add.wire_chat": "Chat Completions",
    "add.wire_hint_chat": "يتعامل Codex نفسه مع Responses API فقط. لذلك تُربط مزودات Chat Completions عبر "
                          "جسر Agentsii المدمج الذي يعمل محلياً على جهازك.",
    "add.wire_hint_responses": "سيتصل Codex بهذا المزود مباشرة.",
    "add.auth": "طريقة المصادقة", "add.auth_bearer": "مفتاح API — ‏Authorization: Bearer",
    "add.auth_header": "مفتاح API — ترويسة مخصصة", "add.auth_none": "بدون مصادقة (خادم محلي)",
    "add.header_name": "اسم الترويسة",
    "add.default": "تعيينه كافتراضي في Codex",
    "add.detect": "اكتشاف البروتوكول تلقائياً", "add.fetch_models": "جلب الموديلات",
    "add.save": "حفظ", "add.save_connect": "حفظ والربط مع Codex",
    "add.saved": "تم حفظ المزود.", "add.detecting": "جارٍ فحص البروتوكولات التي يدعمها المزود…",
    "add.detect_result": "Responses API: {r}   •   Chat Completions: {c}",
    "add.detect_none": "لم يستجب أي بروتوكول. تحقق من الرابط والمفتاح ومعرّف الموديل.",
    "add.fetched": "تم العثور على {n} موديل.", "add.supported": "مدعوم", "add.unsupported": "غير متاح",
    "add.need_url_key": "أدخل الرابط ومعرّف الموديل ومفتاح API أولاً.",
    "prov.title": "مزوداتي", "prov.subtitle": "إدارة المزودات المحفوظة وربطها واختبارها.",
    "prov.col_name": "الاسم", "prov.col_id": "المعرّف", "prov.col_protocol": "البروتوكول", "prov.col_model": "الموديل الافتراضي",
    "prov.col_status": "Codex", "prov.col_key": "المفتاح",
    "prov.connected": "مرتبط", "prov.not_connected": "غير مرتبط", "prov.default": "افتراضي",
    "prov.key_ok": "محفوظ", "prov.key_missing": "مفقود", "prov.key_na": "—",
    "prov.connect": "ربط مع Codex", "prov.disconnect": "فصل", "prov.set_default": "تعيين كافتراضي",
    "prov.test": "اختبار", "prov.empty": "لا توجد مزودات بعد. اضغط «إضافة مزود» للبدء.",
    "prov.confirm_delete": "حذف المزود «{name}»؟ سيُحذف مفتاحه من مدير بيانات الاعتماد وتُزال إعداداته من config.toml (مع الاحتفاظ بنسخة احتياطية).",
    "prov.connect_ok": "تم الربط مع Codex.", "prov.connect_fail": "فشل الربط مع Codex",
    "prov.conflict": "يحتوي config.toml مسبقاً على مزود باسم «{id}» لم ينشئه Agentsii. هل تريد استبداله؟ (ستُنشأ نسخة احتياطية أولاً.)",
    "prov.disconnected": "تمت الإزالة من Codex واستعادة إعداداتك السابقة.",
    "prov.restart_codex": "أعد تشغيل Codex (أو افتح جلسة جديدة) لاستخدام الإعدادات الجديدة.",
    "models.title": "إعدادات الموديل", "models.subtitle": "اختر المزود والموديل الذي يستخدمه Codex افتراضياً.",
    "models.provider": "المزود", "models.list": "الموديلات", "models.add": "إضافة موديل",
    "models.remove": "حذف المحدد", "models.make_default": "استخدام الموديل المحدد في Codex",
    "models.placeholder": "معرّف الموديل، مثل deepseek-chat", "models.applied": "يستخدم Codex الآن {m} من {p}.",
    "models.saved_only": "تم الحفظ. اربط المزود مع Codex لتطبيقه.",
    "models.current": "الافتراضي الحالي في Codex: {v}",
    "test.title": "اختبار الاتصال", "test.subtitle": "يفحص الرابط والمفتاح والموديل والبروتوكول والبث واستدعاء الأدوات.",
    "test.run": "اختبار اتصال API", "test.codex": "التحقق عبر Codex",
    "test.codex_hint": "يرسل طلباً حقيقياً عبر Codex CLI باستخدام هذا المزود (من 10 إلى 60 ثانية تقريباً).",
    "test.no_cli": "لم يتم العثور على Codex CLI — ثبّته لإجراء الفحص الكامل.",
    "test.http_note": "ملاحظة: نجاح اختبار HTTP وحده لا يثبت التوافق الكامل مع Codex. «التحقق عبر Codex» هو الفحص النهائي.",
    "test.model": "الموديل", "test.running": "جارٍ الاختبار…",
    "test.overall_pass": "نجحت جميع الفحوصات", "test.overall_warn": "يعمل مع ملاحظات", "test.overall_fail": "توجد مشكلات",
    "test.check.url": "الرابط الأساسي", "test.check.auth": "مفتاح API", "test.check.model": "الموديل",
    "test.check.protocol": "البروتوكول والبث", "test.check.tools": "استدعاء الأدوات",
    "test.codex_ok": "أجاب Codex بشكل صحيح عبر هذا المزود.", "test.codex_fail": "فشل فحص Codex",
    "test.not_connected": "اربط هذا المزود مع Codex أولاً.",
    "backup.title": "النسخ الاحتياطي والاستعادة",
    "backup.subtitle": "تُؤخذ نسخة احتياطية من config.toml تلقائياً قبل كل تعديل. لا تُضمَّن مفاتيح API أبداً في النسخ أو التصدير.",
    "backup.auto": "نسخ config.toml الاحتياطية", "backup.restore_sel": "استعادة المحدد",
    "backup.confirm_restore": "استبدال config.toml بالنسخة المحددة؟ سيُحفظ الملف الحالي أولاً.",
    "backup.restored": "تمت الاستعادة.", "backup.full": "نسخة احتياطية كاملة",
    "backup.create": "إنشاء ملف نسخة احتياطية…", "backup.restore_file": "الاستعادة من ملف…",
    "backup.created": "حُفظت النسخة في {p}", "backup.full_restored": "تمت الاستعادة. أعد إدخال مفاتيح API للمزودات المعلّمة «مفقود».",
    "backup.export": "تصدير المزودات (بدون المفاتيح)…", "backup.import": "استيراد مزودات…",
    "backup.exported": "تم تصدير المزودات.", "backup.imported": "تم استيراد {n} مزود. وتم تخطي {s} موجود مسبقاً.",
    "backup.keys_note": "المزودات المستوردة تحتاج لإعادة إدخال مفاتيحها (تعديل المزود).",
    "set.title": "الإعدادات", "set.language": "اللغة", "set.codex_home": "مجلد Codex ‏(CODEX_HOME)",
    "set.codex_home_hint": "اتركه فارغاً للاكتشاف التلقائي.", "set.browse": "استعراض…",
    "set.port": "منفذ جسر Agentsii", "set.updates": "التحقق من التحديثات عند تشغيل البرنامج",
    "set.updates_hint": "يقوم فقط بتنزيل ملف إصدار صغير، ولا تُرسل أي بيانات شخصية.",
    "set.check_now": "التحقق من التحديثات الآن", "set.up_to_date": "لديك أحدث إصدار ({v}).",
    "set.update_found": "الإصدار {v} متاح.\n\n{notes}\n\nهل تريد تنزيله وتثبيته الآن؟",
    "set.downloading": "جارٍ تنزيل التحديث…", "set.update_error": "فشل التحقق من التحديث",
    "set.logs": "فتح مجلد السجلات", "set.data": "فتح مجلد بيانات البرنامج", "set.saved": "تم حفظ الإعدادات.",
    "set.privacy": "الخصوصية: تبقى بيانات المزودات والمفاتيح على هذا الجهاز فقط. لا يتم جمع أي بيانات استخدام.",
    "set.port_changed": "تم تغيير المنفذ. أعد ربط المزودات التي تعمل عبر الجسر ليستخدم Codex المنفذ الجديد.",
    "about.title": "عن Agentsii", "about.version": "الإصدار {v}",
    "about.body": "يربط Agentsii Codex Manager برنامج OpenAI Codex بمزودات الذكاء الاصطناعي التي تختارها — "
                  "DeepSeek وOpenRouter وVenice AI وShannon AI أو أي API متوافق مع OpenAI — بدون Terminal "
                  "وبدون تعديل الملفات يدوياً.",
    "about.privacy_title": "بياناتك ملكك",
    "about.privacy": "• تُحفظ مفاتيح API فقط في مدير بيانات الاعتماد في Windows على هذا الجهاز.\n"
                     "• لا تُكتب المفاتيح أبداً في config.toml أو السجلات أو ملفات التصدير أو النسخ الاحتياطية.\n"
                     "• لا يُرسل أي شيء إلى Agentsii، ولا يوجد تتبع للاستخدام.\n"
                     "• يتصل البرنامج فقط بمزوداتك (عند الاختبار أو الاستخدام) وبملف التحديثات.",
    "about.how_title": "كيف يعمل الربط",
    "about.how": "يقرأ Codex إعداداته من config.toml. يضيف Agentsii قسم [model_providers] ويجلب Codex المفتاح "
                 "وقت التشغيل عبر agentsii-helper.exe من مدير بيانات الاعتماد (آلية المصادقة بالأوامر الرسمية "
                 "في Codex). أما المزودات التي تدعم Chat Completions فقط فيخدمها جسر Agentsii على ‎127.0.0.1‎ "
                 "ويحوّل الطلبات إلى Responses API الذي يستخدمه Codex.",
    "about.download": "صفحة التحميل",
}

_TABLES = {"en": EN, "ar": AR}


def set_language(lang: str) -> None:
    global _lang
    _lang = lang if lang in _TABLES else "en"


def language() -> str:
    return _lang


def is_rtl() -> bool:
    return _lang == "ar"


def tr(key: str, **kw) -> str:
    s = _TABLES[_lang].get(key) or EN.get(key) or key
    return s.format(**kw) if kw else s

"""GUI entry point."""
from __future__ import annotations

import argparse
import json
import sys
import traceback


def _selftest(out_path: str | None) -> int:
    """Headless smoke test used by CI on the built EXE: build every page in both languages."""
    import os

    if sys.platform != "win32":
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    result = {"ok": False}
    try:
        from PySide6.QtWidgets import QApplication

        from .core import AppCore
        from .keystore import SecretStore
        from .ui.main_window import PAGES, MainWindow

        app = QApplication.instance() or QApplication(sys.argv)
        core = AppCore()
        core.settings.check_updates_on_startup = False
        w = MainWindow(core)
        for lang in ("en", "ar", "en"):
            w.set_language(lang)
            for key, *_ in PAGES:
                w.go(key)
                app.processEvents()
        result.update(ok=True, pages=len(PAGES), keyring=SecretStore.backend_name(),
                      helper_bundled=_helper_bundled())
    except Exception:  # noqa: BLE001
        result["error"] = traceback.format_exc()
    text = json.dumps(result, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        print(text)
    return 0 if result["ok"] else 1


def _helper_bundled() -> bool:
    from . import paths
    from .version import HELPER_EXE_NAME

    if not getattr(sys, "frozen", False):
        return True
    return (paths.bundle_dir() / HELPER_EXE_NAME).is_file()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--selftest-out", default=None)
    args, _ = ap.parse_known_args(argv)
    if args.selftest:
        return _selftest(args.selftest_out)

    from PySide6.QtCore import QLockFile, Qt
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtWidgets import QApplication, QMessageBox

    from . import paths
    from .logging_setup import setup_logging
    from .version import APP_NAME

    setup_logging("app")
    QGuiApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("Agentsii")
    lock = QLockFile(str(paths.app_data_dir() / "app.lock"))
    lock.setStaleLockTime(0)
    if not lock.tryLock(100):
        QMessageBox.information(None, APP_NAME, f"{APP_NAME} is already running.")
        return 0

    from .core import AppCore
    from .keystore import SecretStoreError
    from .ui.main_window import MainWindow

    try:
        core = AppCore()
    except SecretStoreError as e:
        QMessageBox.critical(None, APP_NAME, str(e))
        return 1
    w = MainWindow(core)
    w.show()
    # Keep bridged providers working if the user opens Codex right after the app.
    if core.bridged_connected():
        from .ui.widgets import run_async

        run_async(core.start_bridge)
    code = app.exec()
    lock.unlock()
    return code


if __name__ == "__main__":
    sys.exit(main())

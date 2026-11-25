from __future__ import annotations

from PySide6.QtWidgets import (QCheckBox, QComboBox, QFileDialog, QFormLayout, QHBoxLayout, QLineEdit,
                               QProgressDialog, QSpinBox, QWidget)

from ... import paths, updater
from ...version import UPDATE_MANIFEST_URL, VERSION
from ..i18n import language, tr
from ..widgets import Card, Page, button, confirm, info, label, open_path, run_async


class SettingsPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("set.title"))
        self.main = main
        s = core.settings
        card = Card()
        form = QFormLayout()
        form.setSpacing(12)
        self.lang = QComboBox()
        self.lang.addItem("English", "en")
        self.lang.addItem("العربية", "ar")
        self.lang.setCurrentIndex(self.lang.findData(language()))
        form.addRow(tr("set.language"), self.lang)

        self.home = QLineEdit(s.codex_home_override)
        self.home.setPlaceholderText(str(paths.detect_codex_home(None)[0]))
        hb = QHBoxLayout()
        hb.setContentsMargins(0, 0, 0, 0)
        hb.addWidget(self.home, 1)
        hb.addWidget(button(tr("set.browse"), on_click=self._browse))
        hw = QWidget()
        hw.setLayout(hb)
        form.addRow(tr("set.codex_home"), hw)
        form.addRow("", label(tr("set.codex_home_hint"), "hint"))

        self.port = QSpinBox()
        self.port.setRange(1024, 65535)
        self.port.setValue(s.bridge_port)
        form.addRow(tr("set.port"), self.port)

        self.updates = QCheckBox(tr("set.updates"))
        self.updates.setChecked(s.check_updates_on_startup)
        form.addRow("", self.updates)
        form.addRow("", label(tr("set.updates_hint"), "hint", wrap=True))
        card.add(form)
        bar = QHBoxLayout()
        bar.addStretch(1)
        bar.addWidget(button(tr("common.save"), "primary", self._save))
        card.add(bar)
        self.body.addWidget(card)

        tools = Card()
        tb = QHBoxLayout()
        tb.addWidget(button(tr("set.check_now"), on_click=self.check_updates))
        tb.addWidget(button(tr("set.logs"), on_click=lambda: open_path(paths.logs_dir())))
        tb.addWidget(button(tr("set.data"), on_click=lambda: open_path(paths.app_data_dir())))
        tb.addStretch(1)
        tools.add(tb)
        tools.add(label(tr("set.privacy"), "hint", wrap=True))
        self.body.addWidget(tools)
        self.finish()

    def _browse(self):
        d = QFileDialog.getExistingDirectory(self, tr("set.codex_home"), self.home.text() or str(paths.detect_codex_home(None)[0]))
        if d:
            self.home.setText(d)

    def _save(self):
        s = self.core.settings
        port_changed = s.bridge_port != self.port.value()
        lang_changed = s.language != self.lang.currentData()
        s.codex_home_override = self.home.text().strip()
        s.bridge_port = self.port.value()
        s.check_updates_on_startup = self.updates.isChecked()
        s.language = self.lang.currentData()
        self.core.save_settings()
        msg = tr("set.saved")
        if port_changed and self.core.bridged_connected():
            msg += "\n" + tr("set.port_changed")
        if lang_changed:
            self.main.set_language(s.language)
            return
        self.banner.show_msg(msg, "pass")

    # ------------------------------------------------------------ updates
    def check_updates(self, silent: bool = False):
        def done(inf):
            if not inf.newer:
                if not silent:
                    info(self, tr("set.up_to_date", v=VERSION))
                return
            self.main.show_update(inf)
            if not silent:
                self.offer_update(inf)

        def err(e):
            if not silent:
                info(self, f"{tr('set.update_error')}: {e}", error=True)

        run_async(updater.check, UPDATE_MANIFEST_URL, on_done=done, on_error=err)

    def offer_update(self, inf):
        notes = inf.notes_ar if language() == "ar" and inf.notes_ar else inf.notes_en
        if not confirm(self, tr("set.update_found", v=inf.version, notes=notes or "")):
            return
        dlg = QProgressDialog(tr("set.downloading"), tr("common.cancel"), 0, 100, self)
        dlg.setMinimumDuration(0)
        dlg.setValue(0)

        def progress(p):
            done_b, total = p
            if total:
                dlg.setValue(int(done_b * 100 / total))

        def ok(path):
            dlg.close()
            try:
                updater.launch_installer(path)
                self.main.quit_for_update()
            except Exception as e:  # noqa: BLE001
                info(self, str(e), error=True)

        def fail(e):
            dlg.close()
            info(self, f"{tr('set.update_error')}: {e}", error=True)

        run_async(lambda progress: updater.download(inf, progress=lambda a, b: progress((a, b))),
                  on_done=ok, on_error=fail, with_progress=progress)

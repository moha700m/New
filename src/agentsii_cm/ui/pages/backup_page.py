from __future__ import annotations

import json
import time
from pathlib import Path

from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QListWidget, QListWidgetItem

from ... import backup, paths
from ...store import ProviderStore
from ...util import atomic_write_text
from ..i18n import tr
from ..widgets import Card, Page, button, confirm, info, label, open_path


class BackupPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("backup.title"), tr("backup.subtitle"))
        self.main = main
        auto = Card(tr("backup.auto"))
        self.list = QListWidget()
        self.list.setMinimumHeight(180)
        auto.add(self.list)
        bar = QHBoxLayout()
        bar.addWidget(button(tr("backup.restore_sel"), "primary", self._restore_selected))
        bar.addWidget(button(tr("common.open_folder"), on_click=lambda: open_path(paths.backups_dir())))
        bar.addStretch(1)
        auto.add(bar)
        self.body.addWidget(auto)

        full = Card(tr("backup.full"))
        fb = QHBoxLayout()
        fb.addWidget(button(tr("backup.create"), on_click=self._create_full))
        fb.addWidget(button(tr("backup.restore_file"), on_click=self._restore_full))
        fb.addStretch(1)
        full.add(fb)
        eb = QHBoxLayout()
        eb.addWidget(button(tr("backup.export"), on_click=self._export))
        eb.addWidget(button(tr("backup.import"), on_click=self._import))
        eb.addStretch(1)
        full.add(eb)
        full.add(label(tr("backup.keys_note"), "hint", wrap=True))
        self.body.addWidget(full)
        self.finish()

    def refresh(self):
        self.list.clear()
        for p in self.core.config_manager().list_backups():
            ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(p.stat().st_mtime))
            reason = p.name.split(".")[-2] if p.name.count(".") >= 3 else ""
            it = QListWidgetItem(f"{ts}    {reason}    {p.name}")
            it.setData(256, str(p))
            self.list.addItem(it)

    def _restore_selected(self):
        it = self.list.currentItem()
        if not it or not confirm(self, tr("backup.confirm_restore")):
            return
        try:
            self.core.config_manager().restore_backup(Path(it.data(256)))
            self._resync_connected()
            self.banner.show_msg(tr("backup.restored") + " " + tr("prov.restart_codex"), "pass")
        except Exception as e:  # noqa: BLE001
            self.banner.show_msg(str(e), "fail")
        self.refresh()

    def _resync_connected(self):
        """After a config restore, mark providers connected only if their table is present."""
        present = set(self.core.config_manager().state().get("providers") or [])
        for p in self.core.store.list():
            self.core.store.set_connected(p.id, p.id in present and p.id in self.core.settings.managed_codex_providers)

    def _create_full(self):
        default = str(Path.home() / f"Agentsii-Codex-Backup-{time.strftime('%Y%m%d-%H%M')}.zip")
        dest, _ = QFileDialog.getSaveFileName(self, tr("backup.create"), default, "Backup (*.zip)")
        if not dest:
            return
        backup.create_backup(Path(dest), paths.providers_file(), paths.settings_file(),
                             self.core.config_manager().config_path)
        self.banner.show_msg(tr("backup.created", p=dest), "pass")

    def _restore_full(self):
        src, _ = QFileDialog.getOpenFileName(self, tr("backup.restore_file"), str(Path.home()), "Backup (*.zip)")
        if not src or not confirm(self, tr("backup.confirm_restore")):
            return
        try:
            data = backup.read_backup(Path(src))
            cm = self.core.config_manager()
            if "codex/config.toml" in data:
                cm.backup("before-full-restore")
                atomic_write_text(cm.config_path, data["codex/config.toml"].decode("utf-8-sig"))
            if "settings.json" in data:
                atomic_write_text(paths.settings_file(), data["settings.json"].decode("utf-8"))
                from ...settings import AppSettings
                self.core.settings.__dict__.update(AppSettings.load().__dict__)
            if "providers.json" in data:
                atomic_write_text(paths.providers_file(), data["providers.json"].decode("utf-8"))
            self._resync_connected()
            self.banner.show_msg(tr("backup.full_restored"), "pass")
        except Exception as e:  # noqa: BLE001
            self.banner.show_msg(str(e), "fail")
        self.refresh()

    def _export(self):
        dest, _ = QFileDialog.getSaveFileName(self, tr("backup.export"),
                                              str(Path.home() / "agentsii-providers.json"), "JSON (*.json)")
        if dest:
            atomic_write_text(Path(dest), self.core.store.export_json())
            self.banner.show_msg(tr("backup.exported"), "pass")

    def _import(self):
        src, _ = QFileDialog.getOpenFileName(self, tr("backup.import"), str(Path.home()), "JSON (*.json)")
        if not src:
            return
        try:
            providers = ProviderStore.parse_export(Path(src).read_text(encoding="utf-8"))
            ok, skipped = self.core.store.import_providers(providers)
            self.banner.show_msg(tr("backup.imported", n=len(ok), s=len(skipped)) + "\n" + tr("backup.keys_note"),
                                 "pass")
        except (ValueError, json.JSONDecodeError, OSError) as e:
            info(self, str(e), error=True)

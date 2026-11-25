from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QAbstractItemView, QHBoxLayout, QHeaderView, QTableWidget, QTableWidgetItem

from ...models import MODE_BRIDGE, WIRE_RESPONSES
from ..i18n import tr
from ..widgets import Card, Page, button, confirm, info, label, run_async


class ProvidersPage(Page):
    COLS = ("prov.col_name", "prov.col_id", "prov.col_protocol", "prov.col_model", "prov.col_key", "prov.col_status")

    def __init__(self, core, main):
        super().__init__(core, tr("prov.title"), tr("prov.subtitle"))
        self.main = main
        card = Card()
        self.table = QTableWidget(0, len(self.COLS))
        self.table.setHorizontalHeaderLabels([tr(c) for c in self.COLS])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(0, QHeaderView.Stretch)
        hh.setSectionResizeMode(3, QHeaderView.Stretch)
        self.table.setMinimumHeight(260)
        self.table.itemSelectionChanged.connect(self._sel_changed)
        self.table.doubleClicked.connect(lambda *_: self._edit())
        card.add(self.table)
        self.empty = label(tr("prov.empty"), "muted")
        card.add(self.empty)

        bar = QHBoxLayout()
        self.b_connect = button(tr("prov.connect"), "primary", self._connect)
        self.b_disconnect = button(tr("prov.disconnect"), on_click=self._disconnect)
        self.b_default = button(tr("prov.set_default"), on_click=self._set_default)
        self.b_test = button(tr("prov.test"), on_click=self._test)
        self.b_edit = button(tr("common.edit"), on_click=self._edit)
        self.b_delete = button(tr("common.delete"), "danger", self._delete)
        for b in (self.b_connect, self.b_disconnect, self.b_default, self.b_test, self.b_edit):
            bar.addWidget(b)
        bar.addStretch(1)
        bar.addWidget(button(tr("nav.add"), on_click=lambda: main.go("add")))
        bar.addWidget(self.b_delete)
        card.add(bar)
        self.body.addWidget(card)
        self.finish()

    def selected_id(self) -> str | None:
        rows = self.table.selectionModel().selectedRows() if self.table.selectionModel() else []
        if not rows:
            return None
        return self.table.item(rows[0].row(), 1).text()

    def refresh(self):
        sel = self.selected_id()
        ps = self.core.store.list()
        self.table.setRowCount(len(ps))
        for r, p in enumerate(ps):
            proto = "Responses" if p.wire_api == WIRE_RESPONSES else "Chat Completions"
            if p.connection_mode == MODE_BRIDGE:
                proto += " • Bridge"
            key = tr("prov.key_na") if not p.needs_key else (
                tr("prov.key_ok") if self.core.keys.has_key(p.id) else tr("prov.key_missing"))
            status = tr("prov.connected") if p.codex_connected else tr("prov.not_connected")
            if p.is_default:
                status += f" • {tr('prov.default')}"
            vals = (p.name, p.id, proto, p.default_model, key, status)
            for c, v in enumerate(vals):
                it = QTableWidgetItem(v)
                if c == 5:
                    it.setForeground(Qt.green if p.codex_connected else Qt.gray)
                if c == 4 and v == tr("prov.key_missing"):
                    it.setForeground(Qt.red)
                self.table.setItem(r, c, it)
            if p.id == sel:
                self.table.selectRow(r)
        self.empty.setVisible(not ps)
        self.table.setVisible(bool(ps))
        self._sel_changed()

    def _sel_changed(self):
        pid = self.selected_id()
        p = self.core.store.get(pid) if pid else None
        for b in (self.b_connect, self.b_disconnect, self.b_default, self.b_test, self.b_edit, self.b_delete):
            b.setEnabled(p is not None)
        if p:
            self.b_connect.setText(tr("prov.connect"))
            self.b_disconnect.setEnabled(p.codex_connected or p.id in self.core.settings.managed_codex_providers)

    # ------------------------------------------------------------- actions
    def _busy(self, on: bool):
        for b in (self.b_connect, self.b_disconnect, self.b_default, self.b_delete):
            b.setEnabled(not on)

    def _connect(self, overwrite: bool = False):
        pid = self.selected_id()
        if not pid:
            return
        self._busy(True)
        self.banner.show_msg(tr("common.working"), "info")

        def done(res):
            self._busy(False)
            if res.ok:
                lines = [tr("prov.connect_ok"), *res.messages, tr("prov.restart_codex")]
                self.banner.show_msg("\n".join(lines), "pass")
            elif "not created by Agentsii" in res.error and not overwrite and confirm(self, tr("prov.conflict", id=pid)):
                return self._connect(overwrite=True)
            else:
                self.banner.show_msg(f"{tr('prov.connect_fail')}: {res.error}", "fail")
            self.refresh()

        run_async(self.core.connect, pid, None, overwrite, on_done=done,
                  on_error=lambda e: (self._busy(False), self.banner.show_msg(e, "fail")))

    def _disconnect(self):
        pid = self.selected_id()
        if not pid:
            return

        def done(res):
            self.banner.show_msg(tr("prov.disconnected") if res.ok else res.error, "pass" if res.ok else "fail")
            self.refresh()

        run_async(self.core.disconnect, pid, on_done=done, on_error=lambda e: self.banner.show_msg(e, "fail"))

    def _set_default(self):
        pid = self.selected_id()
        if not pid:
            return

        def done(res):
            if res is None:
                self.banner.show_msg(tr("models.saved_only"), "info")
            elif res.ok:
                self.banner.show_msg(tr("prov.connect_ok") + " " + tr("prov.restart_codex"), "pass")
            else:
                self.banner.show_msg(f"{tr('prov.connect_fail')}: {res.error}", "fail")
            self.refresh()

        run_async(self.core.set_default, pid, on_done=done, on_error=lambda e: self.banner.show_msg(e, "fail"))

    def _test(self):
        pid = self.selected_id()
        if pid:
            self.main.go("test", provider_id=pid)

    def _edit(self):
        pid = self.selected_id()
        if pid:
            self.main.go("add", provider_id=pid)

    def _delete(self):
        pid = self.selected_id()
        p = self.core.store.get(pid) if pid else None
        if not p or not confirm(self, tr("prov.confirm_delete", name=p.name)):
            return
        try:
            self.core.delete_provider(pid)
        except Exception as e:  # noqa: BLE001
            info(self, str(e), error=True)
        self.banner.hide()
        self.refresh()

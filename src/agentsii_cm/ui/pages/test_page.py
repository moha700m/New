from __future__ import annotations

from PySide6.QtWidgets import QComboBox, QGridLayout, QHBoxLayout, QWidget

from ...tester import verify_with_codex
from ..i18n import tr
from ..widgets import Card, Page, Pill, button, label, run_async

_ICON = {"pass": "✔", "warn": "⚠", "fail": "✖", "skip": "•"}


class TestPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("test.title"), tr("test.subtitle"))
        self.main = main
        card = Card()
        g = QGridLayout()
        g.addWidget(label(tr("models.provider"), "muted"), 0, 0)
        self.provider = QComboBox()
        self.provider.currentIndexChanged.connect(self._load_models)
        g.addWidget(self.provider, 0, 1)
        g.addWidget(label(tr("test.model"), "muted"), 1, 0)
        self.model = QComboBox()
        self.model.setEditable(True)
        g.addWidget(self.model, 1, 1)
        g.setColumnStretch(1, 1)
        card.add(g)
        bar = QHBoxLayout()
        self.run_btn = button(tr("test.run"), "primary", self._run)
        self.codex_btn = button(tr("test.codex"), on_click=self._codex)
        bar.addWidget(self.run_btn)
        bar.addWidget(self.codex_btn)
        bar.addStretch(1)
        card.add(bar)
        card.add(label(tr("test.codex_hint"), "hint", wrap=True))
        self.body.addWidget(card)

        self.results = Card()
        self.overall = Pill("", "skip")
        self.results.add(self.overall)
        self.rows = QWidget()
        self.rows_l = QGridLayout(self.rows)
        self.rows_l.setContentsMargins(0, 0, 0, 0)
        self.rows_l.setVerticalSpacing(10)
        self.results.add(self.rows)
        self.results.add(label(tr("test.http_note"), "hint", wrap=True))
        self.results.hide()
        self.body.addWidget(self.results)
        self.finish()
        self._cli = None

    def preselect(self, provider_id: str | None):
        if provider_id:
            idx = self.provider.findData(provider_id)
            if idx >= 0:
                self.provider.setCurrentIndex(idx)

    def refresh(self):
        cur = self.provider.currentData()
        self.provider.blockSignals(True)
        self.provider.clear()
        for p in self.core.store.list():
            self.provider.addItem(f"{p.name} ({p.id})", p.id)
        i = self.provider.findData(cur)
        self.provider.setCurrentIndex(max(i, 0))
        self.provider.blockSignals(False)
        self._load_models()
        enabled = self.provider.count() > 0
        self.run_btn.setEnabled(enabled)
        run_async(lambda: self.core.detect(with_version=False).cli_path, on_done=self._set_cli)

    def _set_cli(self, path):
        self._cli = path
        self.codex_btn.setEnabled(bool(path) and self.provider.count() > 0)
        self.codex_btn.setToolTip("" if path else tr("test.no_cli"))

    def _load_models(self):
        self.model.clear()
        pid = self.provider.currentData()
        p = self.core.store.get(pid) if pid else None
        if p:
            self.model.addItems(p.models)
            self.model.setCurrentText(p.default_model)

    def _clear_rows(self):
        while self.rows_l.count():
            w = self.rows_l.takeAt(0).widget()
            if w:
                w.deleteLater()

    def _run(self):
        pid = self.provider.currentData()
        if not pid:
            return
        self.run_btn.setEnabled(False)
        self.banner.hide()
        self._clear_rows()
        self.results.show()
        self.overall.set(tr("test.running"), "info")
        run_async(self.core.test_provider, pid, self.model.currentText().strip() or None, on_done=self._show,
                  on_error=self._err)

    def _err(self, e):
        self.run_btn.setEnabled(True)
        self.overall.set(tr("test.overall_fail"), "fail")
        self.banner.show_msg(e, "fail")

    def _show(self, rep):
        self.run_btn.setEnabled(True)
        self._clear_rows()
        self.overall.set({"pass": tr("test.overall_pass"), "warn": tr("test.overall_warn"),
                          "fail": tr("test.overall_fail")}[rep.overall], rep.overall)
        for i, c in enumerate(rep.checks):
            self.rows_l.addWidget(Pill(f"{_ICON.get(c.status, '•')} {tr('test.check.' + c.key)}", c.status), i, 0)
            text = c.message + (f"\n{c.detail}" if c.detail and c.status != "pass" else "")
            self.rows_l.addWidget(label(text, wrap=True), i, 1)
        self.rows_l.setColumnStretch(1, 1)

    def _codex(self):
        pid = self.provider.currentData()
        p = self.core.store.get(pid) if pid else None
        if not p or not self._cli:
            return
        if not p.codex_connected:
            self.banner.show_msg(tr("test.not_connected"), "warn")
            return
        self.codex_btn.setEnabled(False)
        self.banner.show_msg(tr("test.running"), "info")
        model = self.model.currentText().strip() or p.default_model

        def done(res):
            ok, msg = res
            self.codex_btn.setEnabled(True)
            self.banner.show_msg(tr("test.codex_ok") if ok else f"{tr('test.codex_fail')}:\n{msg}",
                                 "pass" if ok else "fail")

        run_async(verify_with_codex, self._cli, p.id, model, on_done=done,
                  on_error=lambda e: (self.codex_btn.setEnabled(True), self.banner.show_msg(e, "fail")))

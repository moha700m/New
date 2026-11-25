from __future__ import annotations

from PySide6.QtWidgets import QComboBox, QHBoxLayout, QLineEdit, QListWidget

from ...models import MODEL_ID_RE
from ..i18n import tr
from ..widgets import Card, Page, button, label, run_async


class ModelsPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("models.title"), tr("models.subtitle"))
        self.main = main
        card = Card()
        h = QHBoxLayout()
        h.addWidget(label(tr("models.provider"), "muted"))
        self.provider = QComboBox()
        self.provider.currentIndexChanged.connect(self._load_models)
        h.addWidget(self.provider, 1)
        card.add(h)
        card.add(label(tr("models.list"), "h2"))
        self.list = QListWidget()
        self.list.setMinimumHeight(200)
        card.add(self.list)
        add = QHBoxLayout()
        self.new_model = QLineEdit()
        self.new_model.setPlaceholderText(tr("models.placeholder"))
        self.new_model.returnPressed.connect(self._add)
        add.addWidget(self.new_model, 1)
        add.addWidget(button(tr("models.add"), on_click=self._add))
        add.addWidget(button(tr("models.remove"), "danger", self._remove))
        card.add(add)
        self.current = label("", "muted", wrap=True)
        card.add(self.current)
        bar = QHBoxLayout()
        bar.addStretch(1)
        self.apply_btn = button(tr("models.make_default"), "primary", self._apply)
        bar.addWidget(self.apply_btn)
        card.add(bar)
        self.body.addWidget(card)
        self.finish()

    def refresh(self):
        cur = self.provider.currentData()
        self.provider.blockSignals(True)
        self.provider.clear()
        for p in self.core.store.list():
            self.provider.addItem(f"{p.name} ({p.id})", p.id)
        idx = self.provider.findData(cur) if cur else -1
        if idx < 0 and self.core.store.default():
            idx = self.provider.findData(self.core.store.default().id)
        self.provider.setCurrentIndex(max(idx, 0))
        self.provider.blockSignals(False)
        self._load_models()
        st = self.core.config_manager().state()
        self.current.setText(tr("models.current", v=f"{st.get('model') or '—'} @ {st.get('model_provider') or 'openai'}"))

    def _provider(self):
        pid = self.provider.currentData()
        return self.core.store.get(pid) if pid else None

    def _load_models(self):
        self.list.clear()
        p = self._provider()
        if not p:
            self.apply_btn.setEnabled(False)
            return
        self.apply_btn.setEnabled(True)
        for m in p.models:
            self.list.addItem(f"★ {m}" if m == p.default_model else m)
            if m == p.default_model:
                self.list.setCurrentRow(self.list.count() - 1)

    def _model_at(self, i):
        return self.list.item(i).text().removeprefix("★ ")

    def _add(self):
        p = self._provider()
        m = self.new_model.text().strip()
        if not p or not m or not MODEL_ID_RE.match(m) or m in p.models:
            return
        p.models.append(m)
        self.core.store.upsert(p, original_id=p.id)
        self.new_model.clear()
        self._load_models()
        self.list.setCurrentRow(self.list.count() - 1)

    def _remove(self):
        p = self._provider()
        row = self.list.currentRow()
        if not p or row < 0 or len(p.models) <= 1:
            return
        m = self._model_at(row)
        p.models.remove(m)
        if p.default_model == m:
            p.default_model = p.models[0]
        self.core.store.upsert(p, original_id=p.id)
        if p.codex_connected:
            run_async(self.core.connect, p.id, on_done=lambda _: self.refresh())
        self._load_models()

    def _apply(self):
        p = self._provider()
        row = self.list.currentRow()
        if not p or row < 0:
            return
        m = self._model_at(row)
        self.apply_btn.setEnabled(False)

        def done(res):
            self.apply_btn.setEnabled(True)
            if res is None:
                self.banner.show_msg(tr("models.saved_only"), "info")
            elif res.ok:
                self.banner.show_msg(tr("models.applied", m=m, p=p.name) + " " + tr("prov.restart_codex"), "pass")
            else:
                self.banner.show_msg(f"{tr('prov.connect_fail')}: {res.error}", "fail")
            self.refresh()

        run_async(self.core.set_default, p.id, m, on_done=done,
                  on_error=lambda e: (self.apply_btn.setEnabled(True), self.banner.show_msg(e, "fail")))

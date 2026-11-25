from __future__ import annotations

import re

from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QComboBox, QFormLayout, QHBoxLayout, QLineEdit,
                               QPlainTextEdit, QRadioButton, QVBoxLayout, QWidget)

from ...codex_config import ProviderConflictError
from ...models import (AUTH_BEARER, AUTH_HEADER, AUTH_NONE, PRESETS, WIRE_CHAT, WIRE_RESPONSES, Provider,
                       ValidationError, normalize_base_url, slugify_provider_id)
from ...tester import ConnectionTester
from ..i18n import tr
from ..widgets import Card, Page, SecretEdit, button, confirm, info, label, run_async


class AddProviderPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("add.title"), tr("add.subtitle"))
        self.main = main
        self.editing_id: str | None = None
        self._id_touched = False

        card = Card()
        form = QFormLayout()
        form.setSpacing(12)
        form.setLabelAlignment(form.labelAlignment())

        self.preset = QComboBox()
        for p in PRESETS:
            self.preset.addItem(p["name"] or tr("add.preset_custom"), p["key"])
        self.preset.currentIndexChanged.connect(self._apply_preset)
        form.addRow(tr("add.preset"), self.preset)

        self.name = QLineEdit()
        self.name.textEdited.connect(self._name_changed)
        form.addRow(tr("add.name"), self.name)

        self.pid = QLineEdit()
        self.pid.textEdited.connect(lambda _: setattr(self, "_id_touched", True))
        form.addRow(tr("add.id"), self._with_hint(self.pid, tr("add.id_hint")))

        self.base = QLineEdit()
        self.base.setPlaceholderText("https://api.example.com/v1")
        form.addRow(tr("add.base_url"), self._with_hint(self.base, tr("add.base_url_hint")))

        self.key = SecretEdit()
        form.addRow(tr("add.api_key"), self.key)

        mrow = QHBoxLayout()
        self.model = QComboBox()
        self.model.setEditable(True)
        self.model.lineEdit().setPlaceholderText("e.g. deepseek-chat")
        mrow.addWidget(self.model, 1)
        mrow.addWidget(button(tr("add.fetch_models"), on_click=self._fetch_models))
        w = QWidget()
        w.setLayout(mrow)
        mrow.setContentsMargins(0, 0, 0, 0)
        form.addRow(tr("add.model"), w)

        self.extra = QPlainTextEdit()
        self.extra.setFixedHeight(64)
        self.extra.setPlaceholderText(tr("add.models_extra_hint"))
        form.addRow(tr("add.models_extra"), self.extra)

        self.wire_group = QButtonGroup(self)
        self.wire_resp = QRadioButton(tr("add.wire_responses"))
        self.wire_chat = QRadioButton(tr("add.wire_chat"))
        self.wire_group.addButton(self.wire_resp)
        self.wire_group.addButton(self.wire_chat)
        wl = QHBoxLayout()
        wl.addWidget(self.wire_resp)
        wl.addWidget(self.wire_chat)
        wl.addStretch(1)
        wl.addWidget(button(tr("add.detect"), on_click=self._detect))
        self.wire_hint = label("", "hint", wrap=True)
        wv = QVBoxLayout()
        wv.setContentsMargins(0, 0, 0, 0)
        wv.addLayout(wl)
        wv.addWidget(self.wire_hint)
        ww = QWidget()
        ww.setLayout(wv)
        self.wire_resp.toggled.connect(self._update_hints)
        form.addRow(tr("add.wire"), ww)

        self.auth = QComboBox()
        self.auth.addItem(tr("add.auth_bearer"), AUTH_BEARER)
        self.auth.addItem(tr("add.auth_header"), AUTH_HEADER)
        self.auth.addItem(tr("add.auth_none"), AUTH_NONE)
        self.auth.currentIndexChanged.connect(self._update_hints)
        form.addRow(tr("add.auth"), self.auth)
        self.header_name = QLineEdit()
        self.header_name.setPlaceholderText("X-API-Key")
        self.header_label = label(tr("add.header_name"))
        form.addRow(self.header_label, self.header_name)

        self.default = QCheckBox(tr("add.default"))
        self.default.setChecked(True)
        form.addRow("", self.default)
        card.add(form)

        self.errors = label("", wrap=True)
        self.errors.setStyleSheet("color: #EF4444;")
        card.add(self.errors)
        btns = QHBoxLayout()
        btns.addStretch(1)
        self.cancel_btn = button(tr("common.cancel"), on_click=self._cancel)
        self.save_btn = button(tr("add.save"), on_click=lambda: self._save(connect=False))
        self.connect_btn = button(tr("add.save_connect"), "primary", lambda: self._save(connect=True))
        for b in (self.cancel_btn, self.save_btn, self.connect_btn):
            btns.addWidget(b)
        card.add(btns)
        self.body.addWidget(card)
        self.finish()
        self.reset()

    # ---------------------------------------------------------------- helpers
    def _with_hint(self, w, hint):
        v = QVBoxLayout()
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(3)
        v.addWidget(w)
        v.addWidget(label(hint, "hint", wrap=True))
        c = QWidget()
        c.setLayout(v)
        return c

    def _name_changed(self, text):
        if not self._id_touched and not self.editing_id:
            self.pid.setText(slugify_provider_id(text) if text.strip() else "")

    def _apply_preset(self):
        key = self.preset.currentData()
        p = next(x for x in PRESETS if x["key"] == key)
        if key != "custom":
            self.name.setText(p["name"])
            if not self._id_touched or not self.pid.text():
                self.pid.setText(p["id"])
            self.base.setText(p["base_url"])
        (self.wire_resp if p["wire_api"] == WIRE_RESPONSES else self.wire_chat).setChecked(True)
        self.auth.setCurrentIndex(self.auth.findData(p["auth_type"]))
        self._update_hints()

    def _update_hints(self):
        is_header = self.auth.currentData() == AUTH_HEADER
        self.header_name.setVisible(is_header)
        self.header_label.setVisible(is_header)
        self.key.setEnabled(self.auth.currentData() != AUTH_NONE)
        bridged = self.wire_chat.isChecked() or is_header
        self.wire_hint.setText(tr("add.wire_hint_chat") if bridged else tr("add.wire_hint_responses"))

    def _models(self) -> list[str]:
        first = self.model.currentText().strip()
        rest = [m.strip() for m in re.split(r"[,\n]", self.extra.toPlainText()) if m.strip()]
        out = []
        for m in [first, *rest]:
            if m and m not in out:
                out.append(m)
        return out

    def build_provider(self) -> Provider:
        models = self._models()
        return Provider(
            id=self.pid.text().strip(), name=self.name.text().strip(),
            base_url=normalize_base_url(self.base.text()),
            wire_api=WIRE_RESPONSES if self.wire_resp.isChecked() else WIRE_CHAT,
            auth_type=self.auth.currentData(), auth_header_name=self.header_name.text().strip(),
            models=models, default_model=models[0] if models else "", is_default=self.default.isChecked(),
        )

    # ---------------------------------------------------------------- modes
    def reset(self):
        self.editing_id = None
        self._id_touched = False
        self.body.itemAt(0).widget().setText(tr("add.title"))
        self.preset.setEnabled(True)
        self.preset.setCurrentIndex(0)
        self._apply_preset()
        self.key.clear()
        self.key.edit.setPlaceholderText("sk-…")
        self.model.clear()
        self.extra.clear()
        self.header_name.clear()
        self.default.setChecked(not self.core.store.default())
        self.errors.setText("")
        self.banner.hide()

    def load(self, provider_id: str):
        p = self.core.store.get(provider_id)
        if not p:
            return self.reset()
        self.editing_id = p.id
        self._id_touched = True
        self.body.itemAt(0).widget().setText(tr("add.edit_title"))
        self.preset.setCurrentIndex(self.preset.findData("custom"))
        self.name.setText(p.name)
        self.pid.setText(p.id)
        self.base.setText(p.base_url)
        self.key.clear()
        self.key.edit.setPlaceholderText(tr("add.api_key_keep") if self.core.keys.has_key(p.id) else "sk-…")
        self.model.clear()
        self.model.addItems(p.models)
        self.model.setCurrentText(p.default_model)
        self.extra.setPlainText("\n".join(m for m in p.models if m != p.default_model))
        (self.wire_resp if p.wire_api == WIRE_RESPONSES else self.wire_chat).setChecked(True)
        self.auth.setCurrentIndex(self.auth.findData(p.auth_type))
        self.header_name.setText(p.auth_header_name)
        self.default.setChecked(p.is_default)
        self.errors.setText("")
        self.banner.hide()
        self._update_hints()

    def _cancel(self):
        self.reset()
        self.main.go("providers")

    # ---------------------------------------------------------------- actions
    def _save(self, connect: bool):
        self.errors.setText("")
        p = self.build_provider()
        try:
            saved = self.core.save_provider(p, self.key.text() or None, original_id=self.editing_id)
        except ValidationError as e:
            self.errors.setText("\n".join(f"• {v}" for v in e.errors.values()))
            return
        except Exception as e:  # noqa: BLE001
            self.errors.setText(str(e))
            return
        self.key.clear()
        if not connect and not (self.editing_id and saved.codex_connected):
            self.main.notify(tr("add.saved"))
            self.reset()
            self.main.go("providers")
            return
        self._connect(saved.id, overwrite=False)

    def _connect(self, pid: str, overwrite: bool):
        self.connect_btn.setEnabled(False)
        self.banner.show_msg(tr("common.working"), "info")

        def done(res):
            self.connect_btn.setEnabled(True)
            if res.ok:
                self.main.notify(tr("prov.connect_ok") + " " + tr("prov.restart_codex"))
                self.reset()
                self.main.go("providers")
            else:
                if "not created by Agentsii" in res.error and not overwrite:
                    if confirm(self, tr("prov.conflict", id=pid)):
                        return self._connect(pid, overwrite=True)
                self.banner.show_msg(f"{tr('prov.connect_fail')}: {res.error}", "fail")

        run_async(self.core.connect, pid, None, overwrite, on_done=done,
                  on_error=lambda e: (self.connect_btn.setEnabled(True),
                                      self.banner.show_msg(f"{tr('prov.connect_fail')}: {e}", "fail")))

    def _tester(self):
        p = self.build_provider()
        key = self.key.text() or (self.core.keys.get_key(self.editing_id) if self.editing_id else None)
        if not p.base_url or (p.needs_key and not key):
            self.banner.show_msg(tr("add.need_url_key"), "warn")
            return None, None
        if not p.models:
            p.models, p.default_model = ["-"], "-"
        return p, key

    def _fetch_models(self):
        p, key = self._tester()
        if not p:
            return

        def work():
            from ...tester import TestReport
            t = ConnectionTester(p, key, timeout=20)
            rep = TestReport(p.id, p.default_model)
            t.check_models(rep)
            return rep

        def done(rep):
            if rep.detected_models:
                cur = self.model.currentText()
                self.model.clear()
                self.model.addItems(sorted(rep.detected_models))
                self.model.setCurrentText(cur or rep.detected_models[0])
                self.banner.show_msg(tr("add.fetched", n=len(rep.detected_models)), "pass")
            else:
                msg = "; ".join(c.message for c in rep.checks) or "—"
                self.banner.show_msg(msg, "warn")

        self.banner.show_msg(tr("common.working"), "info")
        run_async(work, on_done=done, on_error=lambda e: self.banner.show_msg(e, "fail"))

    def _detect(self):
        p, key = self._tester()
        if not p:
            return
        if p.default_model == "-":
            self.banner.show_msg(tr("add.need_url_key"), "warn")
            return
        self.banner.show_msg(tr("add.detecting"), "info")

        def done(res):
            r, c = res.get(WIRE_RESPONSES), res.get(WIRE_CHAT)
            fmt = lambda ok: tr("add.supported") if ok else tr("add.unsupported")  # noqa: E731
            if r:
                self.wire_resp.setChecked(True)
            elif c:
                self.wire_chat.setChecked(True)
            msg = tr("add.detect_result", r=fmt(r), c=fmt(c)) if (r or c) else tr("add.detect_none")
            self.banner.show_msg(msg, "pass" if (r or c) else "fail")

        run_async(lambda: ConnectionTester(p, key, timeout=25).detect_protocols(p.default_model),
                  on_done=done, on_error=lambda e: self.banner.show_msg(e, "fail"))

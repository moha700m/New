from __future__ import annotations

from PySide6.QtWidgets import QGridLayout, QHBoxLayout, QVBoxLayout

from ...models import MODE_BRIDGE
from ..i18n import tr
from ..widgets import Card, Page, Pill, button, info, label, open_path, run_async


class DashboardPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("dash.title"), tr("dash.subtitle"))
        self.main = main
        grid = QGridLayout()
        grid.setSpacing(16)

        # Codex card
        self.codex_card = Card(tr("dash.codex"))
        self.cli = self._kv(self.codex_card, tr("dash.codex_cli"))
        self.desktop = self._kv(self.codex_card, tr("dash.desktop"))
        self.ide = self._kv(self.codex_card, tr("dash.ide"))
        self.home = self._kv(self.codex_card, tr("dash.codex_home"))
        self.cfg = self._kv(self.codex_card, tr("dash.config"))
        self.no_codex = label(tr("dash.no_codex_hint"), "hint", wrap=True)
        self.codex_card.add(self.no_codex)
        self.codex_card.add(button(tr("common.open_folder"), on_click=lambda: open_path(self.core.codex_home)))
        grid.addWidget(self.codex_card, 0, 0, 2, 1)

        # Default card
        self.def_card = Card(tr("dash.default"))
        self.def_value = label("—", "statValue", wrap=True)
        self.def_sub = label("", "muted", wrap=True)
        self.def_card.add(self.def_value)
        self.def_card.add(self.def_sub)
        grid.addWidget(self.def_card, 0, 1)

        # Providers card
        self.prov_card = Card(tr("dash.providers"))
        self.prov_value = label("0", "statValue")
        self.prov_sub = label("", "muted")
        self.prov_card.add(self.prov_value)
        self.prov_card.add(self.prov_sub)
        grid.addWidget(self.prov_card, 1, 1)

        # Bridge card
        self.br_card = Card(tr("dash.bridge"))
        h = QHBoxLayout()
        self.br_pill = Pill("…")
        h.addWidget(self.br_pill)
        h.addStretch(1)
        self.br_start = button(tr("dash.start_bridge"), on_click=self._start_bridge)
        self.br_stop = button(tr("dash.stop_bridge"), on_click=self._stop_bridge)
        h.addWidget(self.br_start)
        h.addWidget(self.br_stop)
        self.br_card.add(h)
        self.br_card.add(label(tr("dash.bridge_hint"), "hint", wrap=True))
        grid.addWidget(self.br_card, 2, 0, 1, 2)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        self.body.addLayout(grid)

        quick = Card(tr("dash.quick"))
        qh = QHBoxLayout()
        qh.addWidget(button(tr("nav.add"), "primary", lambda: main.go("add")))
        qh.addWidget(button(tr("nav.providers"), on_click=lambda: main.go("providers")))
        qh.addWidget(button(tr("nav.test"), on_click=lambda: main.go("test")))
        qh.addStretch(1)
        quick.add(qh)
        self.body.addWidget(quick)
        self.finish()

    def _kv(self, card: Card, key: str):
        h = QHBoxLayout()
        k = label(key, "muted")
        k.setMinimumWidth(150)
        v = label("…", wrap=True)
        h.addWidget(k)
        h.addWidget(v, 1)
        card.add(h)
        return v

    def refresh(self):
        run_async(lambda: self.core.detect(with_version=True), on_done=self._show_detect)
        providers = self.core.store.list()
        connected = [p for p in providers if p.codex_connected]
        self.prov_value.setText(str(len(providers)))
        self.prov_sub.setText(f"{len(connected)} {tr('dash.connected')} • {len(providers)} {tr('dash.saved')}")
        st = self.core.config_manager().state()
        managed = set(self.core.settings.managed_codex_providers)
        if st.get("error"):
            self.def_value.setText("config.toml ⚠")
            self.def_sub.setText(st["error"])
        elif st.get("model_provider") in managed:
            p = self.core.store.get(st["model_provider"])
            self.def_value.setText(st.get("model") or "—")
            self.def_sub.setText(f"{p.name if p else st['model_provider']} ({st['model_provider']})")
        else:
            self.def_value.setText(st.get("model") or "Codex default")
            self.def_sub.setText(tr("dash.default_none"))
        self._refresh_bridge()

    def _show_detect(self, d):
        self.cli.setText(f"{d.cli_path}  (v{d.cli_version})" if d.cli_path and d.cli_version
                         else d.cli_path or tr("dash.not_found"))
        self.desktop.setText(tr("dash.found") if d.desktop_app else tr("dash.not_found"))
        self.ide.setText(tr("dash.found") if d.ide_extensions else tr("dash.not_found"))
        self.home.setText(f"{d.codex_home}  [{d.codex_home_source}]")
        self.cfg.setText(f"{tr('dash.exists') if d.config_exists else tr('dash.missing')}")
        self.no_codex.setVisible(not d.any_found)

    def _refresh_bridge(self):
        def show(h):
            needed = any(p.connection_mode == MODE_BRIDGE for p in self.core.store.list())
            if h:
                self.br_pill.set(f"{tr('dash.bridge_running')} • 127.0.0.1:{self.core.settings.bridge_port}", "pass")
            else:
                self.br_pill.set(tr("dash.bridge_stopped"), "warn" if needed else "skip")
            self.br_start.setVisible(not h)
            self.br_stop.setVisible(bool(h))
        run_async(self.core.bridge_status, on_done=show, on_error=lambda e: show(None))

    def _start_bridge(self):
        self.br_start.setEnabled(False)

        def done(ok):
            self.br_start.setEnabled(True)
            if not ok:
                info(self, f"127.0.0.1:{self.core.settings.bridge_port} — {tr('dash.bridge_stopped')}", error=True)
            self._refresh_bridge()

        run_async(self.core.start_bridge, on_done=done,
                  on_error=lambda e: (self.br_start.setEnabled(True), info(self, e, error=True)))

    def _stop_bridge(self):
        run_async(self.core.stop_bridge, on_done=lambda _: self._refresh_bridge())

from __future__ import annotations

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (QApplication, QButtonGroup, QHBoxLayout, QLabel, QMainWindow, QPushButton,
                               QStackedWidget, QVBoxLayout, QWidget)

from .. import paths
from ..version import APP_NAME, VERSION
from . import theme
from .i18n import is_rtl, set_language, tr
from .pages.about import AboutPage
from .pages.add_provider import AddProviderPage
from .pages.backup_page import BackupPage
from .pages.dashboard import DashboardPage
from .pages.models import ModelsPage
from .pages.providers import ProvidersPage
from .pages.settings_page import SettingsPage
from .pages.test_page import TestPage
from .widgets import Pill, button, label

PAGES = [
    ("dashboard", "nav.dashboard", "◧", DashboardPage),
    ("add", "nav.add", "＋", AddProviderPage),
    ("providers", "nav.providers", "☰", ProvidersPage),
    ("models", "nav.models", "◎", ModelsPage),
    ("test", "nav.test", "⚡", TestPage),
    ("backup", "nav.backup", "⟲", BackupPage),
    ("settings", "nav.settings", "⚙", SettingsPage),
    ("about", "nav.about", "ⓘ", AboutPage),
]


def app_icon() -> QIcon:
    for p in (paths.bundle_dir() / "assets" / "icon.ico",
              paths.bundle_dir().parent.parent / "packaging" / "assets" / "icon.ico"):
        if p.is_file():
            return QIcon(str(p))
    return QIcon()


class MainWindow(QMainWindow):
    def __init__(self, core):
        super().__init__()
        self.core = core
        self.setWindowTitle(f"{APP_NAME} {VERSION}")
        self.setWindowIcon(app_icon())
        self.resize(1180, 780)
        self.setMinimumSize(980, 640)
        self._update_info = None
        self.build()
        if core.settings.check_updates_on_startup:
            QTimer.singleShot(2500, lambda: self.pages["settings"].check_updates(silent=True))

    # --------------------------------------------------------------- building
    def build(self):
        set_language(self.core.settings.language)
        app = QApplication.instance()
        app.setLayoutDirection(Qt.RightToLeft if is_rtl() else Qt.LeftToRight)
        app.setStyleSheet(theme.stylesheet(is_rtl()))
        root = QWidget()
        root.setObjectName("root")
        h = QHBoxLayout(root)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)

        side = QWidget()
        side.setObjectName("sidebar")
        side.setFixedWidth(236)
        sv = QVBoxLayout(side)
        sv.setContentsMargins(14, 20, 14, 16)
        sv.setSpacing(4)
        brand = QHBoxLayout()
        logo = QLabel()
        ic = app_icon()
        if not ic.isNull():
            logo.setPixmap(ic.pixmap(34, 34))
        brand.addWidget(logo)
        bt = QVBoxLayout()
        bt.setSpacing(0)
        bt.addWidget(label("Agentsii", "brand"))
        bt.addWidget(label("Codex Manager", "brandSub"))
        brand.addLayout(bt, 1)
        sv.addLayout(brand)
        sv.addSpacing(18)

        self.stack = QStackedWidget()
        self.pages: dict = {}
        self.nav: dict = {}
        group = QButtonGroup(self)
        group.setExclusive(True)
        for key, tkey, glyph, cls in PAGES:
            b = QPushButton(f"{glyph}   {tr(tkey)}".replace("&", "&&"))
            b.setObjectName("nav")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, k=key: self.go(k))
            group.addButton(b)
            sv.addWidget(b)
            self.nav[key] = b
            page = cls(self.core, self)
            self.pages[key] = page
            self.stack.addWidget(page)
        sv.addStretch(1)
        self.update_pill = Pill("", "info")
        self.update_pill.hide()
        sv.addWidget(self.update_pill)
        self.update_btn = button(tr("dash.update_now"), "primary", self._do_update)
        self.update_btn.hide()
        sv.addWidget(self.update_btn)
        self.lang_btn = button("العربية" if not is_rtl() else "English", "link",
                               lambda: self.set_language("en" if is_rtl() else "ar"))
        sv.addWidget(self.lang_btn)
        sv.addWidget(label(f"v{VERSION}", "hint"))
        h.addWidget(side)
        h.addWidget(self.stack, 1)
        self.setCentralWidget(root)
        if self._update_info:
            self.show_update(self._update_info)
        self.go("dashboard")

    def set_language(self, lang: str):
        current = self.stack.currentIndex() if hasattr(self, "stack") else 0
        self.core.settings.language = lang
        self.core.save_settings()
        old = self.centralWidget()
        self.build()
        if old is not None:
            old.deleteLater()
        self.go(PAGES[current][0])

    # --------------------------------------------------------------- navigation
    def go(self, key: str, provider_id: str | None = None):
        page = self.pages[key]
        self.nav[key].setChecked(True)
        self.stack.setCurrentWidget(page)
        if key == "add":
            if provider_id:
                page.load(provider_id)
            elif page.editing_id:
                page.reset()
        page.refresh()
        if key == "test" and provider_id:
            page.preselect(provider_id)

    def notify(self, text: str):
        page = self.stack.currentWidget()
        QTimer.singleShot(0, lambda: self.pages["providers"].banner.show_msg(text, "pass"))

    # --------------------------------------------------------------- updates
    def show_update(self, inf):
        self._update_info = inf
        self.update_pill.set(tr("dash.update_available", v=inf.version), "info")
        self.update_pill.show()
        self.update_btn.show()

    def _do_update(self):
        if self._update_info:
            self.pages["settings"].offer_update(self._update_info)

    def quit_for_update(self):
        QApplication.instance().quit()

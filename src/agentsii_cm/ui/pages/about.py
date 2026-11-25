from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout

from ... import paths
from ...version import APP_NAME, COPYRIGHT, DOWNLOAD_PAGE_URL, VERSION
from ..i18n import tr
from ..widgets import Card, Page, button, label, open_url


class AboutPage(Page):
    def __init__(self, core, main):
        super().__init__(core, tr("about.title"))
        head = Card()
        h = QHBoxLayout()
        logo = QLabel()
        icon = paths.bundle_dir() / "assets" / "icon-256.png"
        if not icon.is_file():
            icon = paths.bundle_dir().parent.parent / "packaging" / "assets" / "icon-256.png"
        if icon.is_file():
            logo.setPixmap(QPixmap(str(icon)).scaled(88, 88, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        h.addWidget(logo)
        v = QVBoxLayout()
        v.addWidget(label(APP_NAME, "h1"))
        v.addWidget(label(tr("about.version", v=VERSION), "muted"))
        v.addWidget(label(tr("app.tagline"), "muted"))
        h.addLayout(v, 1)
        head.add(h)
        head.add(label(tr("about.body"), wrap=True))
        bar = QHBoxLayout()
        bar.addWidget(button(tr("about.download"), on_click=lambda: open_url(DOWNLOAD_PAGE_URL)))
        bar.addStretch(1)
        head.add(bar)
        self.body.addWidget(head)
        pr = Card(tr("about.privacy_title"))
        pr.add(label(tr("about.privacy"), wrap=True))
        self.body.addWidget(pr)
        how = Card(tr("about.how_title"))
        how.add(label(tr("about.how"), "muted", wrap=True))
        self.body.addWidget(how)
        self.body.addWidget(label(COPYRIGHT, "hint"))
        self.finish()

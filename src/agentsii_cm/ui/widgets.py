"""Reusable widgets and helpers."""
from __future__ import annotations

import traceback
from typing import Any, Callable

from PySide6.QtCore import QObject, QRunnable, Qt, QThreadPool, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPushButton, QScrollArea,
                               QSizePolicy, QToolButton, QVBoxLayout, QWidget)

from . import theme
from .i18n import tr


# ------------------------------------------------------------------ background work
class _Signals(QObject):
    done = Signal(object)
    failed = Signal(str)
    progress = Signal(object)


class _Task(QRunnable):
    def __init__(self, fn: Callable, *args, **kwargs):
        super().__init__()
        self.fn, self.args, self.kwargs = fn, args, kwargs
        self.signals = _Signals()

    def run(self):
        try:
            res = self.fn(*self.args, **self.kwargs)
        except Exception as e:  # noqa: BLE001 - surface every error to the UI
            from ..logging_setup import redact
            import logging

            logging.getLogger("agentsii.ui").error("task failed: %s", redact(traceback.format_exc()))
            self.signals.failed.emit(redact(str(e)) or type(e).__name__)
            return
        self.signals.done.emit(res)


_alive: set = set()


def run_async(fn: Callable, *args, on_done: Callable[[Any], None] | None = None,
              on_error: Callable[[str], None] | None = None, with_progress: Callable[[Any], None] | None = None,
              **kwargs) -> None:
    """Run fn in a worker thread; callbacks run on the UI thread."""
    task = _Task(fn, *args, **kwargs)
    if with_progress is not None:
        task.kwargs["progress"] = task.signals.progress.emit
        task.signals.progress.connect(with_progress)
    _alive.add(task.signals)

    def _cleanup(*_):
        _alive.discard(task.signals)

    if on_done:
        task.signals.done.connect(on_done)
    if on_error:
        task.signals.failed.connect(on_error)
    task.signals.done.connect(_cleanup)
    task.signals.failed.connect(_cleanup)
    task.setAutoDelete(True)
    QThreadPool.globalInstance().start(task)


# ------------------------------------------------------------------ layout bits
def label(text: str, obj: str | None = None, wrap: bool = False) -> QLabel:
    lb = QLabel(text)
    if obj:
        lb.setObjectName(obj)
    if wrap:
        lb.setWordWrap(True)
    lb.setTextInteractionFlags(Qt.TextSelectableByMouse)
    return lb


def button(text: str, kind: str | None = None, on_click: Callable | None = None) -> QPushButton:
    b = QPushButton(text.replace("&", "&&"))
    if kind:
        b.setObjectName(kind)
    b.setCursor(Qt.PointingHandCursor)
    if on_click:
        b.clicked.connect(on_click)
    return b


class Card(QFrame):
    def __init__(self, title: str | None = None, parent=None):
        super().__init__(parent)
        self.setObjectName("card")
        self.lay = QVBoxLayout(self)
        self.lay.setContentsMargins(18, 16, 18, 16)
        self.lay.setSpacing(10)
        if title:
            self.lay.addWidget(label(title, "h2"))

    def add(self, w):
        if isinstance(w, QWidget):
            self.lay.addWidget(w)
        else:
            self.lay.addLayout(w)
        return w


class Pill(QLabel):
    def __init__(self, text: str = "", status: str = "info"):
        super().__init__(text)
        self.set(text, status)
        self.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Fixed)

    def set(self, text: str, status: str = "info"):
        c = theme.STATUS_COLORS.get(status, theme.MUTED)
        self.setText(text)
        self.setStyleSheet(f"QLabel {{ color: {c}; background: {c}22; border: 1px solid {c}55; border-radius: 10px;"
                           f" padding: 2px 10px; font-weight: 600; font-size: 8.5pt; }}")


class Banner(QLabel):
    def __init__(self):
        super().__init__()
        self.setObjectName("banner")
        self.setWordWrap(True)
        self.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.hide()

    def show_msg(self, text: str, status: str = "info"):
        c = theme.STATUS_COLORS.get(status, theme.ACCENT_2)
        self.setStyleSheet(f"QLabel#banner {{ background: {c}1A; border: 1px solid {c}66; color: {theme.TEXT}; }}")
        self.setText(text)
        self.show()


class Page(QWidget):
    """Scrollable page with a title and subtitle."""

    def __init__(self, core, title: str, subtitle: str = "", parent=None):
        super().__init__(parent)
        self.core = core
        self.setObjectName("page")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        inner = QWidget()
        self.body = QVBoxLayout(inner)
        self.body.setContentsMargins(32, 28, 32, 28)
        self.body.setSpacing(16)
        self.body.addWidget(label(title, "h1"))
        if subtitle:
            self.body.addWidget(label(subtitle, "muted", wrap=True))
        self.banner = Banner()
        self.body.addWidget(self.banner)
        scroll.setWidget(inner)
        outer.addWidget(scroll)

    def finish(self):
        self.body.addStretch(1)

    def refresh(self):
        pass


class SecretEdit(QWidget):
    """Password field with a Show/Hide toggle."""

    def __init__(self, placeholder: str = ""):
        super().__init__()
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)
        self.edit = QLineEdit()
        self.edit.setEchoMode(QLineEdit.Password)
        self.edit.setPlaceholderText(placeholder)
        self.edit.setAttribute(Qt.WA_InputMethodEnabled, False)
        self.toggle = QToolButton()
        self.toggle.setText(tr("add.show"))
        self.toggle.setCheckable(True)
        self.toggle.setCursor(Qt.PointingHandCursor)
        self.toggle.setStyleSheet(f"QToolButton {{ background: {theme.SURFACE_2}; border: 1px solid {theme.BORDER};"
                                  f" border-radius: 8px; padding: 7px 12px; }}")
        self.toggle.toggled.connect(self._on_toggle)
        lay.addWidget(self.edit, 1)
        lay.addWidget(self.toggle)

    def _on_toggle(self, on: bool):
        self.edit.setEchoMode(QLineEdit.Normal if on else QLineEdit.Password)
        self.toggle.setText(tr("add.hide") if on else tr("add.show"))

    def text(self) -> str:
        return self.edit.text().strip()

    def clear(self):
        self.edit.clear()
        self.toggle.setChecked(False)


def confirm(parent, text: str, title: str | None = None) -> bool:
    box = QMessageBox(parent)
    box.setIcon(QMessageBox.Question)
    box.setWindowTitle(title or tr("common.warning"))
    box.setText(text)
    yes = box.addButton(tr("common.yes"), QMessageBox.YesRole)
    box.addButton(tr("common.no"), QMessageBox.NoRole)
    box.exec()
    return box.clickedButton() is yes


def info(parent, text: str, title: str | None = None, error: bool = False) -> None:
    box = QMessageBox(parent)
    box.setIcon(QMessageBox.Critical if error else QMessageBox.Information)
    box.setWindowTitle(title or (tr("common.error") if error else tr("common.success")))
    box.setText(text)
    box.addButton(tr("common.ok"), QMessageBox.AcceptRole)
    box.exec()


def open_path(path) -> None:
    QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))


def open_url(url: str) -> None:
    QDesktopServices.openUrl(QUrl(url))


def row(*widgets, stretch_last: bool = False, spacing: int = 8) -> QHBoxLayout:
    h = QHBoxLayout()
    h.setSpacing(spacing)
    for w in widgets:
        if w is None:
            h.addStretch(1)
        elif isinstance(w, QWidget):
            h.addWidget(w)
        else:
            h.addLayout(w)
    if stretch_last:
        h.addStretch(1)
    return h

"""Agentsii dark theme."""

BG = "#0B0D12"
SURFACE = "#12151C"
SURFACE_2 = "#181C25"
BORDER = "#262B36"
TEXT = "#E8EAF0"
MUTED = "#8B93A7"
ACCENT = "#7C6CFF"
ACCENT_HOVER = "#9184FF"
ACCENT_2 = "#22D3EE"
SUCCESS = "#22C55E"
WARNING = "#F59E0B"
DANGER = "#EF4444"

STATUS_COLORS = {"pass": SUCCESS, "warn": WARNING, "fail": DANGER, "skip": MUTED, "info": ACCENT_2}


def stylesheet(rtl: bool = False) -> str:
    font = '"Segoe UI Variable Text", "Segoe UI", "Noto Sans Arabic", "Noto Sans", sans-serif'
    return f"""
* {{ font-family: {font}; font-size: 10pt; color: {TEXT}; }}
QMainWindow, QWidget#root {{ background: {BG}; }}
QWidget#page {{ background: {BG}; }}
QScrollArea {{ background: transparent; border: none; }}
QScrollArea > QWidget > QWidget {{ background: transparent; }}
QWidget#sidebar {{ background: {SURFACE}; border-{'left' if rtl else 'right'}: 1px solid {BORDER}; }}
QLabel#brand {{ font-size: 15pt; font-weight: 700; }}
QLabel#brandSub {{ color: {MUTED}; font-size: 8.5pt; }}
QPushButton#nav {{
    text-align: {'right' if rtl else 'left'}; padding: 9px 14px; border: none; border-radius: 8px;
    background: transparent; color: {MUTED}; font-weight: 500;
}}
QPushButton#nav:hover {{ background: {SURFACE_2}; color: {TEXT}; }}
QPushButton#nav:checked {{ background: rgba(124,108,255,0.16); color: {TEXT}; font-weight: 600; }}
QLabel#h1 {{ font-size: 18pt; font-weight: 700; }}
QLabel#h2 {{ font-size: 12pt; font-weight: 600; }}
QLabel#muted, QLabel#hint {{ color: {MUTED}; }}
QLabel#hint {{ font-size: 8.5pt; }}
QFrame#card {{ background: {SURFACE}; border: 1px solid {BORDER}; border-radius: 12px; }}
QLabel#statValue {{ font-size: 16pt; font-weight: 700; }}
QLineEdit, QPlainTextEdit, QComboBox, QSpinBox, QListWidget, QTableWidget {{
    background: {SURFACE_2}; border: 1px solid {BORDER}; border-radius: 8px; padding: 7px 9px;
    selection-background-color: {ACCENT};
}}
QLineEdit:focus, QPlainTextEdit:focus, QComboBox:focus, QSpinBox:focus {{ border: 1px solid {ACCENT}; }}
QLineEdit[invalid="true"] {{ border: 1px solid {DANGER}; }}
QComboBox::drop-down {{ border: none; width: 22px; }}
QComboBox QAbstractItemView {{ background: {SURFACE_2}; border: 1px solid {BORDER}; selection-background-color: {ACCENT}; }}
QPushButton {{
    background: {SURFACE_2}; border: 1px solid {BORDER}; border-radius: 8px; padding: 8px 14px; font-weight: 500;
}}
QPushButton:hover {{ border-color: {ACCENT}; }}
QPushButton:disabled {{ color: #555c6e; border-color: {BORDER}; }}
QPushButton#primary {{ background: {ACCENT}; border: 1px solid {ACCENT}; color: white; font-weight: 600; }}
QPushButton#primary:hover {{ background: {ACCENT_HOVER}; }}
QPushButton#primary:disabled {{ background: #3b3570; border-color: #3b3570; color: #b9b4e8; }}
QPushButton#danger {{ color: {DANGER}; }}
QPushButton#danger:hover {{ border-color: {DANGER}; }}
QPushButton#danger:disabled {{ color: #555c6e; }}
QPushButton#link {{ background: transparent; border: none; color: {ACCENT_2}; padding: 2px; }}
QCheckBox {{ spacing: 8px; }}
QCheckBox::indicator {{ width: 18px; height: 18px; border-radius: 5px; border: 1px solid {BORDER}; background: {SURFACE_2}; }}
QCheckBox::indicator:checked {{ background: {ACCENT}; border-color: {ACCENT}; }}
QRadioButton::indicator {{ width: 16px; height: 16px; border-radius: 8px; border: 1px solid {BORDER}; background: {SURFACE_2}; }}
QRadioButton::indicator:checked {{ background: {ACCENT}; border: 4px solid {SURFACE_2}; }}
QHeaderView::section {{ background: {SURFACE}; color: {MUTED}; border: none; border-bottom: 1px solid {BORDER}; padding: 8px; font-weight: 600; }}
QTableWidget {{ gridline-color: transparent; padding: 0; }}
QTableWidget::item {{ padding: 6px; border-bottom: 1px solid {BORDER}; }}
QTableWidget::item:selected {{ background: rgba(124,108,255,0.22); }}
QListWidget::item {{ padding: 6px; border-radius: 6px; }}
QListWidget::item:selected {{ background: rgba(124,108,255,0.25); }}
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: {BORDER}; border-radius: 4px; min-height: 30px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 2px; }}
QScrollBar::handle:horizontal {{ background: {BORDER}; border-radius: 4px; min-width: 30px; }}
QToolTip {{ background: {SURFACE_2}; color: {TEXT}; border: 1px solid {BORDER}; padding: 6px; }}
QMessageBox {{ background: {SURFACE}; }}
QProgressBar {{ background: {SURFACE_2}; border: 1px solid {BORDER}; border-radius: 6px; text-align: center; height: 14px; }}
QProgressBar::chunk {{ background: {ACCENT}; border-radius: 6px; }}
QLabel#banner {{ border-radius: 8px; padding: 10px 12px; }}
"""

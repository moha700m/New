"""Build all Windows deliverables (run on Windows, e.g. the GitHub Actions windows runner).

    python packaging/build.py            # helper + app (installer folder) + portable + installer
    python packaging/build.py --no-iscc  # skip Inno Setup

Outputs in dist/release/:
    AgentsiiCodexManager-Setup-<ver>.exe
    AgentsiiCodexManager-Portable-<ver>.exe
    SHA256SUMS.txt, latest.json (update manifest template)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "packaging"
DIST = ROOT / "dist"
BUILD = ROOT / "build"
REL = DIST / "release"
sys.path.insert(0, str(ROOT / "src"))
from agentsii_cm.version import APP_NAME, COPYRIGHT, DOWNLOAD_PAGE_URL, PUBLISHER, VERSION, VERSION_TUPLE  # noqa: E402

SEP = os.pathsep
EXCLUDES = ["tkinter", "unittest", "pydoc", "PySide6.QtNetwork", "PySide6.QtQml", "PySide6.QtQuick",
            "PySide6.QtWebEngineCore", "PySide6.QtMultimedia", "PySide6.Qt3DCore", "PySide6.QtPdf"]


def run(cmd: list[str]) -> None:
    print(">", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT)


def version_file(name: str, desc: str) -> Path:
    v = VERSION_TUPLE + (0,) * (4 - len(VERSION_TUPLE))
    text = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v}, prodvers={v}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', '{PUBLISHER}'),
      StringStruct('FileDescription', '{desc}'),
      StringStruct('FileVersion', '{VERSION}'),
      StringStruct('InternalName', '{name}'),
      StringStruct('LegalCopyright', '{COPYRIGHT}'),
      StringStruct('OriginalFilename', '{name}.exe'),
      StringStruct('ProductName', '{APP_NAME}'),
      StringStruct('ProductVersion', '{VERSION}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    BUILD.mkdir(exist_ok=True)
    p = BUILD / f"version_{name}.txt"
    p.write_text(text, encoding="utf-8")
    return p


def pyinstaller(args: list[str]) -> None:
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
         "--distpath", str(DIST), "--workpath", str(BUILD / "pyi"), "--specpath", str(BUILD),
         "--paths", str(ROOT / "src"), *args])


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-iscc", action="store_true")
    a = ap.parse_args()
    shutil.rmtree(DIST, ignore_errors=True)
    REL.mkdir(parents=True)
    icon = PKG / "assets" / "icon.ico"
    if not icon.is_file():
        run([sys.executable, str(PKG / "make_icon.py")])

    # 1) console helper used by Codex (auth command + bridge)
    pyinstaller(["--onefile", "--console", "--name", "agentsii-helper", "--icon", str(icon),
                 "--version-file", str(version_file("agentsii-helper", f"{APP_NAME} credential helper")),
                 "--hidden-import", "keyring.backends.Windows", "--exclude-module", "PySide6",
                 *sum((["--exclude-module", m] for m in EXCLUDES), []), str(ROOT / "helper_main.py")])
    helper = DIST / "agentsii-helper.exe"
    common = ["--windowed", "--icon", str(icon),
              "--add-binary", f"{helper}{SEP}.", "--add-data", f"{PKG / 'assets'}{SEP}assets",
              "--hidden-import", "keyring.backends.Windows",
              *sum((["--exclude-module", m] for m in EXCLUDES), [])]

    # 2) GUI, folder build (wrapped by the installer)
    pyinstaller(["--onedir", "--name", "AgentsiiCodexManager",
                 "--version-file", str(version_file("AgentsiiCodexManager", APP_NAME)), *common,
                 str(ROOT / "app_main.py")])
    # 3) GUI, single-file portable build
    portable_name = f"AgentsiiCodexManager-Portable-{VERSION}"
    pyinstaller(["--onefile", "--name", portable_name,
                 "--version-file", str(version_file(portable_name, f"{APP_NAME} (Portable)")), *common,
                 str(ROOT / "app_main.py")])
    shutil.copy2(DIST / f"{portable_name}.exe", REL / f"{portable_name}.exe")

    # 4) installer
    if not a.no_iscc:
        iscc = shutil.which("iscc") or r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
        run([iscc, f"/DMyAppVersion={VERSION}", f"/DMyAppURL={DOWNLOAD_PAGE_URL}", f"/O{REL}",
             str(PKG / "installer.iss")])

    # 5) checksums + update manifest template
    sums, files = [], {}
    for f in sorted(REL.glob("*.exe")):
        h = sha256(f)
        sums.append(f"{h}  {f.name}")
        files[f.name] = {"sha256": h, "size": f.stat().st_size}
    (REL / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="utf-8")
    setup = f"AgentsiiCodexManager-Setup-{VERSION}.exe"
    manifest = {"version": VERSION, "released": time.strftime("%Y-%m-%d"),
                "notes": json.loads((PKG / "notes.json").read_text(encoding="utf-8")),
                "installer": {"url": f"__BASE__/{setup}", **files.get(setup, {"sha256": "", "size": 0})},
                "portable": {"url": f"__BASE__/{portable_name}.exe", **files[f"{portable_name}.exe"]}}
    (REL / "latest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("\n".join(sums))


if __name__ == "__main__":
    main()

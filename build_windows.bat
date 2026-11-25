@echo off
REM ================================================================
REM  Agentsii Codex Manager - local Windows build (for the publisher)
REM  Requirements on the build PC (one time):
REM    - Python 3.12 (python.org, tick "Add python.exe to PATH")
REM    - Inno Setup 6 (jrsoftware.org)   -> for the installer EXE
REM  Double-click this file. Results: dist\release\
REM ================================================================
setlocal
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.12 is not installed or not on PATH. & pause & exit /b 1)
if not exist .venv\Scripts\python.exe python -m venv .venv || goto :err
call .venv\Scripts\activate.bat || goto :err
python -m pip install --upgrade pip || goto :err
pip install -r requirements-dev.txt || goto :err
python -m pytest -q || goto :err
python packaging\build.py || goto :err
python packaging\ci_verify.py
echo.
echo Done. Files are in dist\release
explorer dist\release
pause
exit /b 0
:err
echo.
echo Build failed - see the messages above.
pause
exit /b 1

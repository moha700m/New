"""PyInstaller entry for the console helper (agentsii-helper.exe)."""
import sys

from agentsii_cm.helper_cli import main

if __name__ == "__main__":
    sys.exit(main())

"""Standalone launcher: makes `loom` importable regardless of cwd, then serves."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from loom.cli import serve  # noqa: E402

if __name__ == "__main__":
    serve()

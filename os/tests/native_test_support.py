"""Compile the production non-fast-math boundary for native fixture tests."""
from pathlib import Path
import subprocess

def fpclassify_object(directory):
    root = Path(__file__).resolve().parents[2]
    output = Path(directory)/'fpclassify.o'
    subprocess.run(['c++', '-std=c++20', '-fPIC', '-fno-fast-math', '-fno-lto',
                    '-c', str(root/'src/util/fpclassify.cpp'), '-o', str(output)], check=True)
    return str(output)

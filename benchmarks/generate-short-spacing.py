"""Regenerate the short-spacing references using the same settings as the steady reference."""
import argparse
import gzip
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from apps.doublet.model import Case, simulate

source = root / "apps/web/public/data/doublet-steady.json.gz"
reference = json.loads(gzip.decompress(source.read_bytes()))
parser = argparse.ArgumentParser()
parser.add_argument("--spacing", type=int, choices=(400, 600), default=400)
spacing = parser.parse_args().spacing
case = Case(**{**reference["case"], "spacing": spacing})
with tempfile.TemporaryDirectory() as directory:
    result = simulate(case, Path(directory))
result["capex"] = reference["capex"]
target = Path(__file__).with_name(f"gassum-{spacing}m.json.gz")
target.write_bytes(gzip.compress(json.dumps(result, separators=(",", ":")).encode(), mtime=0))

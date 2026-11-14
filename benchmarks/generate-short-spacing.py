"""Regenerate the 400 m holdout using the same settings as the steady reference."""
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
case = Case(**{**reference["case"], "spacing": 400})
with tempfile.TemporaryDirectory() as directory:
    result = simulate(case, Path(directory))
result["capex"] = reference["capex"]
target = Path(__file__).with_name("gassum-400m.json.gz")
target.write_bytes(gzip.compress(json.dumps(result, separators=(",", ":")).encode(), mtime=0))

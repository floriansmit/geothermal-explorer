import json
import sys
from pathlib import Path

from .model import Case, simulate

if __name__ == "__main__":
    directory = Path(sys.argv[1])
    result = simulate(Case.model_validate_json(sys.stdin.read()), directory)
    (directory / "result.json").write_text(json.dumps(result, allow_nan=False))

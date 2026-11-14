"""Optional workstation service; isolate native DARTS runs from the web process."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .model import Case

app = FastAPI(title="Geothermal Explorer local doublet")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "https://decode-geothermal-explorer.floriansmit88.chatgpt.site",
                   *filter(None, (s.strip() for s in os.getenv("DOUBLET_ALLOWED_ORIGINS", "").split(",")))],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)
busy = Lock()


@app.post("/v1/doublet/run")
def run(case: Case):
    if not busy.acquire(blocking=False):
        raise HTTPException(
            409, "A doublet case is already running on this workstation"
        )
    try:
        with tempfile.TemporaryDirectory() as directory:
            with (Path(directory) / "engine.log").open("w") as log:
                subprocess.run(
                    [sys.executable, "-m", "apps.doublet.worker", directory],
                    input=case.model_dump_json(),
                    text=True,
                    stdout=log,
                    stderr=log,
                    check=True,
                    cwd=Path(__file__).resolve().parents[2],
                    timeout=900,
                    env={**os.environ, "OMP_NUM_THREADS": "1"},
                )
            return json.loads((Path(directory) / "result.json").read_text())
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            504, "Run exceeded 15 minutes. Try a coarser grid or shorter horizon."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            422, "DARTS failed. Check reservoir properties, controls and grid."
        ) from exc
    finally:
        busy.release()

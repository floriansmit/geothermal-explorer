"""The optional DARTS suite also exercises the isolated solver process."""

import base64
import pytest

pytest.importorskip("darts")
from fastapi.testclient import TestClient
from apps.doublet.server import app


def test_selected_cell_run():
    case = dict(
        depth=1800,
        thickness=40,
        porosity=0.2,
        permeability=300,
        temperature=65,
        injection=30,
        winter=100,
        summer=60,
        pressure_window=50,
        extent=3000,
        resolution=150,
        years=1,
    )
    client = TestClient(app)
    assert (
        client.post("/v1/doublet/run", json={**case, "spacing": 6000}).status_code
        == 422
    )
    response = client.post("/v1/doublet/run", json=case)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["n"] == 20
    assert result["wells"] == [[6, 10], [14, 10]]
    import numpy as np

    field = np.frombuffer(base64.b64decode(result["frames"][0]), dtype="<i2").reshape(
        20, 20
    )
    assert field[10, 6] > 100 and abs(field[10, 14]) < 10
    history = result["history"]
    assert history[-1][0] == pytest.approx(365.25)
    assert -history[-1][2] / 24 == pytest.approx(60, rel=0.01)

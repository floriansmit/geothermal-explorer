"""Uniform single-layer, pure-water doublet on a local Cartesian grid."""

import base64
import math
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field, model_validator


class Case(BaseModel, allow_inf_nan=False):
    depth: float = Field(gt=0, le=6000)
    thickness: float = Field(gt=0, le=2000)  # net metres
    porosity: float = Field(gt=0, lt=1)
    permeability: float = Field(gt=0, le=50000)  # mD
    temperature: float = Field(gt=5, le=180)
    injection: float = Field(ge=5)
    extent: int = Field(default=5000, ge=1000, le=10000)
    resolution: int = Field(default=50, ge=25, le=200)
    spacing: float = Field(default=1200, gt=0)
    azimuth: float = Field(default=90, ge=0, le=360)
    winter: float = Field(gt=0, le=600)
    summer: float = Field(gt=0, le=600)
    pressure_window: float = Field(gt=0, le=200)
    years: int = Field(default=30, ge=1, le=50)

    @model_validator(mode="after")
    def check_geometry(self):
        if self.extent % self.resolution or not 10 <= self.n <= 120:
            raise ValueError("Choose 10–120 whole cells per side")
        if not 2 * self.resolution <= self.spacing <= self.extent - 4 * self.resolution:
            raise ValueError(
                "Allow two cells between wells and clearance at the boundary"
            )
        if self.injection >= self.temperature or self.pressure <= 3:
            raise ValueError("Check injection temperature and reservoir depth")
        return self

    @property
    def n(self):
        return self.extent // self.resolution

    @property
    def pressure(self):
        return 1.013 + 0.0981 * (self.depth + self.thickness / 2)

    def wells(self):
        angle = math.radians(self.azimuth)
        delta = self.spacing / (2 * self.resolution)
        # Zero-based cell indices, east and north increasing.
        return [
            (
                math.floor(self.n / 2 + sign * delta * math.sin(angle) + 1e-9),
                math.floor(self.n / 2 + sign * delta * math.cos(angle) + 1e-9),
            )
            for sign in (-1, 1)
        ]


def simulate(case: Case, folder: Path):
    from darts.models.darts_model import DartsModel
    from darts.reservoirs.struct_reservoir import StructReservoir
    from darts.physics.iapws_physics import IAPWSPhysics
    from darts.physics.base.physics import PhysicsBase
    from darts.physics.base.property_container import PropertyContainer
    from darts.physics.properties.basic import ConstFunc, PhaseRelPerm
    from darts.physics.properties.eos_properties import EoSDensity, EoSEnthalpy
    from darts.physics.properties.viscosity import MaoDuan2009
    from darts.engines import well_control_iface as ctrl
    from dartsflash.mixtures import CompData, DARTSFlash, EoS, IAPWS

    class LocalModel(DartsModel):
        def __init__(self):
            super().__init__()
            self.reservoir = StructReservoir(
                self.timer,
                nx=case.n,
                ny=case.n,
                nz=1,
                dx=case.resolution,
                dy=case.resolution,
                dz=case.thickness,
                permx=case.permeability,
                permy=case.permeability,
                permz=case.permeability,
                poro=case.porosity,
                depth=case.depth + case.thickness / 2,
                hcap=2200.0,
                rcond=216.0,
            )  # kJ/m3/K and kJ/m/day/K
            for edge in ("yz_minus", "yz_plus", "xz_minus", "xz_plus"):
                self.reservoir.boundary_volumes[edge] = 1e12
            phases = ["V", "L"]
            self.physics = IAPWSPhysics(
                phases,
                self.timer,
                state_spec=PhysicsBase.StateSpecification.PT,
                axes_step=[2.0, 2.0],
                axes_origin=[1.0, 273.15],
                cache=False,
            )
            mixture = IAPWS(iapws_ideal=True, ice_phase=False)
            mixture.init_flash(flash_type=DARTSFlash.FlashType.PTFlash)
            self.physics.set_mixture(mixture)
            water = PropertyContainer(
                phases_name=phases,
                components_name=["H2O"],
                Mw=CompData(components=["H2O"], setprops=True).Mw,
                eps_z=1e-12,
            )
            self.physics.add_property_region(water)
            water.flash_ev = self.physics.get_flash_ev()
            for phase, root in zip(phases, (EoS.RootFlag.MAX, EoS.RootFlag.MIN)):
                water.density_ev[phase] = EoSDensity(
                    eos=mixture.eos["IAPWS"], root_flag=root
                )
                water.enthalpy_ev[phase] = EoSEnthalpy(
                    eos=mixture.eos["IAPWS"], root_flag=root
                )
            water.viscosity_ev = {"V": ConstFunc(0.01), "L": MaoDuan2009(["H2O"])}
            water.rel_perm_ev = {
                "V": PhaseRelPerm("gas", swc=0.0),
                "L": PhaseRelPerm("oil", swc=0.0),
            }
            water.conductivity_ev = {"V": ConstFunc(0.0), "L": ConstFunc(172.8)}

        def set_wells(self):
            for name, (i, j) in zip(("INJ", "PRD"), case.wells()):
                self.reservoir.add_well(name)
                self.reservoir.add_perforation(
                    name, res_cell_idx=(i + 1, j + 1, 1), well_diameter=0.22
                )

        def set_initial_conditions(self):
            self.physics.set_initial_conditions_from_array(
                self.reservoir.mesh,
                {"pressure": case.pressure, "temperature": case.temperature + 273.15},
            )

        def set_well_controls(self, rate=None):
            for idx, well in enumerate(self.reservoir.wells):
                inj = idx == 0
                options = dict(
                    is_inj=inj, inj_temp=case.injection + 273.15 if inj else None
                )
                self.physics.set_well_controls(
                    well.control,
                    ctrl.VOLUMETRIC_RATE,
                    target=24 * (case.winter if rate is None else rate),
                    phase_name="L",
                    **options,
                )
                limit = (
                    case.pressure + case.pressure_window / 2
                    if inj
                    else max(2.0, case.pressure - case.pressure_window / 2)
                )
                self.physics.set_well_controls(
                    well.constraint, ctrl.BHP, target=limit, **options
                )

    model = LocalModel()
    model.init()
    model.ts_control.dt_max = 30.0
    model.set_output(output_folder=str(folder))
    frames = []
    for year in range(case.years):
        for target in (case.winter, case.summer):
            model.set_well_controls(target)
            model.run(
                365.25 / 2, restart_dt=1.0, save_reservoir_data=False, verbose=False
            )
        state = np.asarray(model.physics.engine.X).reshape(-1, 2)[: case.n**2]
        # Integer tenths of a degree of cooling, x varying fastest.
        cooling = (case.temperature + 273.15 - state[:, 1]) * 10
        if not np.isfinite(cooling).all():
            raise ValueError("Non-finite reservoir temperature")
        frames.append(
            base64.b64encode(np.rint(cooling).astype("<i2").tobytes()).decode()
        )
    wells = model.output.store_well_time_data(
        phase_molar_rate=False,
        phase_mass_rate=False,
        component_molar_rate=False,
        component_mass_rate=False,
        energy_rate=False,
    )
    names = [
        "time",
        "well_PRD_BHT",
        "well_PRD_volumetric_rate_L_at_wh",
        "well_INJ_BHP",
        "well_PRD_BHP",
    ]
    series = np.column_stack([wells[name] for name in names])
    if not np.isfinite(series).all():
        raise ValueError("Non-finite well history")
    return dict(
        case=case.model_dump(),
        n=case.n,
        wells=case.wells(),
        frames=frames,
        history=series.tolist(),
    )

"""Narrow, stateless OR-Tools HTTP sidecar for SCM optimization jobs."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from ortools.sat.python import cp_model

SOLVER_VERSION = "ortools-9.15.6755"
MAX_BODY_BYTES = 2_000_000
MAX_LOCATIONS = 500
MAX_VEHICLES = 100
MAX_ITEMS = 500


class ContractError(ValueError):
    """Raised when the bounded JSON contract is invalid."""


def _dictionary(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{field} must be an object")
    return value


def _array(value: Any, field: str, maximum: int) -> list[Any]:
    if not isinstance(value, list) or not value or len(value) > maximum:
        raise ContractError(f"{field} must contain 1..{maximum} items")
    return value


def _integer(value: Any, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ContractError(f"{field} must be an integer >= {minimum}")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ContractError(f"{field} must be a non-empty string <= 200 chars")
    return value.strip()


def _matrix(value: Any, field: str, size: int) -> list[list[int]]:
    rows = _array(value, field, MAX_LOCATIONS)
    if len(rows) != size:
        raise ContractError(f"{field} must be {size}x{size}")
    parsed: list[list[int]] = []
    for row_index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != size:
            raise ContractError(f"{field}[{row_index}] must contain {size} values")
        parsed.append(
            [_integer(item, f"{field}[{row_index}] value") for item in row]
        )
    return parsed


def solve_routes(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = _text(payload.get("requestId"), "requestId")
    locations_raw = _array(payload.get("locations"), "locations", MAX_LOCATIONS)
    vehicles_raw = _array(payload.get("vehicles"), "vehicles", MAX_VEHICLES)
    locations = [
        _text(_dictionary(value, "location").get("id"), "location.id")
        for value in locations_raw
    ]
    if len(set(locations)) != len(locations):
        raise ContractError("location ids must be unique")
    distance = _matrix(payload.get("distanceMatrix"), "distanceMatrix", len(locations))
    duration = _matrix(payload.get("durationMatrix"), "durationMatrix", len(locations))
    vehicles: list[dict[str, Any]] = []
    for raw in vehicles_raw:
        vehicle = _dictionary(raw, "vehicle")
        vehicles.append(
            {
                "id": _text(vehicle.get("id"), "vehicle.id"),
                "capacity": _integer(vehicle.get("capacity"), "vehicle.capacity", 1),
                "maxMinutes": _integer(vehicle.get("maxMinutes"), "vehicle.maxMinutes", 1),
                "fixedCost": _integer(vehicle.get("fixedCost", 0), "vehicle.fixedCost"),
            }
        )
    if len({vehicle["id"] for vehicle in vehicles}) != len(vehicles):
        raise ContractError("vehicle ids must be unique")
    stops_raw = payload.get("stops")
    if not isinstance(stops_raw, list) or len(stops_raw) != len(locations) - 1:
        raise ContractError("stops must contain every non-depot location exactly once")
    stop_by_location: dict[int, dict[str, Any]] = {}
    stop_ids: set[str] = set()
    for raw in stops_raw:
        stop = _dictionary(raw, "stop")
        location_index = _integer(stop.get("locationIndex"), "stop.locationIndex", 1)
        if location_index >= len(locations) or location_index in stop_by_location:
            raise ContractError("stop.locationIndex must uniquely reference a non-depot location")
        start = _integer(stop.get("windowStartMinutes", 0), "stop.windowStartMinutes")
        end = _integer(stop.get("windowEndMinutes"), "stop.windowEndMinutes", 1)
        if start > end:
            raise ContractError("stop time window is invalid")
        stop_id = _text(stop.get("id"), "stop.id")
        if stop_id in stop_ids:
            raise ContractError("stop ids must be unique")
        stop_ids.add(stop_id)
        stop_by_location[location_index] = {
            "id": stop_id,
            "demand": _integer(stop.get("demand"), "stop.demand"),
            "serviceMinutes": _integer(stop.get("serviceMinutes", 0), "stop.serviceMinutes"),
            "windowStartMinutes": start,
            "windowEndMinutes": end,
        }
    manager = pywrapcp.RoutingIndexManager(len(locations), len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        return distance[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    distance_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(distance_index)
    for vehicle_index, vehicle in enumerate(vehicles):
        routing.SetFixedCostOfVehicle(vehicle["fixedCost"], vehicle_index)

    def demand_callback(index: int) -> int:
        stop = stop_by_location.get(manager.IndexToNode(index))
        return int(stop["demand"]) if stop else 0

    demand_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_index, 0, [vehicle["capacity"] for vehicle in vehicles], True, "Capacity"
    )

    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        service = int(stop_by_location.get(from_node, {}).get("serviceMinutes", 0))
        return duration[from_node][to_node] + service

    time_index = routing.RegisterTransitCallback(time_callback)
    maximum_minutes = max(vehicle["maxMinutes"] for vehicle in vehicles)
    routing.AddDimension(time_index, maximum_minutes, maximum_minutes, True, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")
    for location_index, stop in stop_by_location.items():
        index = manager.NodeToIndex(location_index)
        time_dimension.CumulVar(index).SetRange(
            int(stop["windowStartMinutes"]), int(stop["windowEndMinutes"])
        )
    for vehicle_index, vehicle in enumerate(vehicles):
        time_dimension.CumulVar(routing.End(vehicle_index)).SetMax(vehicle["maxMinutes"])

    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    parameters.time_limit.seconds = min(_integer(payload.get("timeLimitSeconds", 5), "timeLimitSeconds", 1), 30)
    solution = routing.SolveWithParameters(parameters)
    constraint_codes = ["ALL_STOPS_ASSIGNED", "CAPACITY", "TIME_WINDOWS", "DRIVER_HOURS"]
    if solution is None:
        return {
            "requestId": request_id,
            "solver": "OR_TOOLS_ROUTING",
            "solverVersion": SOLVER_VERSION,
            "status": "INFEASIBLE",
            "objectiveValue": None,
            "routes": [],
            "constraints": [
                {"code": code, "satisfied": False, "detail": "No feasible assignment found"}
                for code in constraint_codes
            ],
            "explanation": "No route satisfies every mandatory stop, capacity, time-window and driver-hours constraint.",
        }
    routes: list[dict[str, Any]] = []
    assigned = 0
    total_distance = 0
    for vehicle_index, vehicle in enumerate(vehicles):
        index = routing.Start(vehicle_index)
        route_stops: list[str] = []
        arrivals: list[int] = []
        route_distance = 0
        load = 0
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != 0:
                stop = stop_by_location[node]
                route_stops.append(str(stop["id"]))
                arrivals.append(solution.Value(time_dimension.CumulVar(index)))
                load += int(stop["demand"])
                assigned += 1
            next_index = solution.Value(routing.NextVar(index))
            route_distance += distance[node][manager.IndexToNode(next_index)]
            index = next_index
        if route_stops:
            duration_minutes = solution.Value(time_dimension.CumulVar(index))
            total_distance += route_distance
            routes.append(
                {
                    "vehicleId": vehicle["id"],
                    "stopIds": route_stops,
                    "arrivalMinutes": arrivals,
                    "distance": route_distance,
                    "durationMinutes": duration_minutes,
                    "load": load,
                }
            )
    return {
        "requestId": request_id,
        "solver": "OR_TOOLS_ROUTING",
        "solverVersion": SOLVER_VERSION,
        "status": "FEASIBLE",
        "objectiveValue": solution.ObjectiveValue(),
        "routes": routes,
        "constraints": [
            {"code": code, "satisfied": True, "detail": "Constraint satisfied by the saved assignment"}
            for code in constraint_codes
        ],
        "explanation": f"Assigned {assigned} mandatory stops to {len(routes)} of {len(vehicles)} vehicles over {total_distance} distance units.",
    }


def solve_load(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = _text(payload.get("requestId"), "requestId")
    containers_raw = _array(payload.get("containers"), "containers", MAX_VEHICLES)
    items_raw = _array(payload.get("items"), "items", MAX_ITEMS)
    containers: list[dict[str, Any]] = []
    for raw in containers_raw:
        value = _dictionary(raw, "container")
        containers.append(
            {
                "id": _text(value.get("id"), "container.id"),
                "maxWeight": _integer(value.get("maxWeight"), "container.maxWeight", 1),
                "maxVolume": _integer(value.get("maxVolume"), "container.maxVolume", 1),
                "bayCount": _integer(value.get("bayCount"), "container.bayCount", 1),
                "maxCgOffset": _integer(value.get("maxCgOffset", 100), "container.maxCgOffset"),
            }
        )
    items: list[dict[str, Any]] = []
    for raw in items_raw:
        value = _dictionary(raw, "item")
        incompatible = value.get("incompatibleWith", [])
        if not isinstance(incompatible, list) or any(not isinstance(item, str) for item in incompatible):
            raise ContractError("item.incompatibleWith must be a string array")
        items.append(
            {
                "id": _text(value.get("id"), "item.id"),
                "weight": _integer(value.get("weight"), "item.weight", 1),
                "volume": _integer(value.get("volume"), "item.volume", 1),
                "unloadSequence": _integer(value.get("unloadSequence"), "item.unloadSequence"),
                "incompatibleWith": incompatible,
            }
        )
    item_index = {item["id"]: index for index, item in enumerate(items)}
    if len(item_index) != len(items) or len({item["id"] for item in containers}) != len(containers):
        raise ContractError("item and container ids must be unique")
    model = cp_model.CpModel()
    assignments: dict[tuple[int, int], cp_model.IntVar] = {}
    bays: dict[int, cp_model.IntVar] = {}
    for item_no, _item in enumerate(items):
        bays[item_no] = model.new_int_var(0, max(container["bayCount"] for container in containers) - 1, f"bay_{item_no}")
        choices = []
        for container_no, container in enumerate(containers):
            assigned = model.new_bool_var(f"assign_{item_no}_{container_no}")
            assignments[item_no, container_no] = assigned
            choices.append(assigned)
            model.add(bays[item_no] < container["bayCount"]).only_enforce_if(assigned)
        model.add_exactly_one(choices)
    for container_no, container in enumerate(containers):
        model.add(sum(item["weight"] * assignments[item_no, container_no] for item_no, item in enumerate(items)) <= container["maxWeight"])
        model.add(sum(item["volume"] * assignments[item_no, container_no] for item_no, item in enumerate(items)) <= container["maxVolume"])
        center = (container["bayCount"] - 1) * 100
        assigned_bays = []
        for item_no, _item in enumerate(items):
            position = model.new_int_var(0, container["bayCount"] - 1, f"position_{item_no}_{container_no}")
            model.add(position == bays[item_no]).only_enforce_if(assignments[item_no, container_no])
            model.add(position == 0).only_enforce_if(assignments[item_no, container_no].Not())
            assigned_bays.append(position)
        moment = sum(
            item["weight"]
            * (2 * assigned_bays[item_no] * 100 - center * assignments[item_no, container_no])
            for item_no, item in enumerate(items)
        )
        tolerance = container["maxCgOffset"] * sum(item["weight"] * assignments[item_no, container_no] for item_no, item in enumerate(items))
        model.add(moment <= tolerance)
        model.add(moment >= -tolerance)
    for first_no, item in enumerate(items):
        for incompatible_id in item["incompatibleWith"]:
            second_no = item_index.get(incompatible_id)
            if second_no is None:
                raise ContractError("item.incompatibleWith references an unknown item")
            for container_no, _container in enumerate(containers):
                model.add(assignments[first_no, container_no] + assignments[second_no, container_no] <= 1)
        for second_no, second in enumerate(items):
            if item["unloadSequence"] < second["unloadSequence"]:
                for container_no, _container in enumerate(containers):
                    both = model.new_bool_var(f"same_{first_no}_{second_no}_{container_no}")
                    model.add_bool_and([assignments[first_no, container_no], assignments[second_no, container_no]]).only_enforce_if(both)
                    model.add_bool_or([assignments[first_no, container_no].Not(), assignments[second_no, container_no].Not(), both])
                    model.add(bays[first_no] <= bays[second_no]).only_enforce_if(both)
    used = []
    for container_no, _container in enumerate(containers):
        variable = model.new_bool_var(f"used_{container_no}")
        model.add_max_equality(variable, [assignments[item_no, container_no] for item_no in range(len(items))])
        used.append(variable)
    model.minimize(sum(used) * 10_000 + sum(bays.values()))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = min(_integer(payload.get("timeLimitSeconds", 5), "timeLimitSeconds", 1), 30)
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "requestId": request_id,
            "solver": "OR_TOOLS_CP_SAT",
            "solverVersion": SOLVER_VERSION,
            "status": "INFEASIBLE",
            "placements": [],
            "constraints": [{"code": "LOAD_HARD_CONSTRAINTS", "satisfied": False, "detail": "No feasible placement found"}],
            "explanation": "No placement satisfies weight, volume, center-of-gravity, incompatibility and unloading-order constraints.",
        }
    placements = []
    for item_no, item in enumerate(items):
        container_no = next(index for index in range(len(containers)) if solver.value(assignments[item_no, index]))
        placements.append({"itemId": item["id"], "containerId": containers[container_no]["id"], "bay": solver.value(bays[item_no])})
    return {
        "requestId": request_id,
        "solver": "OR_TOOLS_CP_SAT",
        "solverVersion": SOLVER_VERSION,
        "status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        "objectiveValue": solver.objective_value,
        "placements": placements,
        "constraints": [
            {"code": code, "satisfied": True, "detail": "Constraint satisfied by the saved placement"}
            for code in ["WEIGHT", "VOLUME", "CENTER_OF_GRAVITY", "INCOMPATIBILITY", "UNLOADING_ORDER"]
        ],
        "explanation": f"Placed {len(items)} items across {sum(solver.value(value) for value in used)} containers.",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "scm-optimizer/1"

    def log_message(self, format_string: str, *args: Any) -> None:
        print(json.dumps({"event": "optimizer.http", "message": format_string % args}))

    def _write(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._write(404, {"code": "NOT_FOUND", "message": "Route not found"})
            return
        self._write(200, {"status": "ok", "solverVersion": SOLVER_VERSION})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._write(413, {"code": "REQUEST_SIZE_INVALID", "message": "Body must be 1..2000000 bytes"})
            return
        try:
            payload = _dictionary(json.loads(self.rfile.read(length)), "body")
            if self.path == "/v1/solve/routes":
                result = solve_routes(payload)
            elif self.path == "/v1/solve/load":
                result = solve_load(payload)
            else:
                self._write(404, {"code": "NOT_FOUND", "message": "Route not found"})
                return
            self._write(200, result)
        except (ContractError, json.JSONDecodeError) as error:
            self._write(400, {"code": "OPTIMIZER_INPUT_INVALID", "message": str(error)})
        except Exception:
            self._write(500, {"code": "OPTIMIZER_INTERNAL", "message": "Solver execution failed"})


if __name__ == "__main__":
    host = os.environ.get("OPTIMIZER_HOST", "0.0.0.0")
    port = int(os.environ.get("OPTIMIZER_PORT", "8090"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()

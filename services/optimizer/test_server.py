import unittest

from server import ContractError, solve_load, solve_routes


class RouteSolverTest(unittest.TestCase):
    def test_honors_capacity_and_time_windows(self):
        result = solve_routes(
            {
                "requestId": "route-test",
                "locations": [{"id": "depot"}, {"id": "a"}, {"id": "b"}],
                "vehicles": [{"id": "v1", "capacity": 10, "maxMinutes": 100, "fixedCost": 5}],
                "stops": [
                    {"id": "s1", "locationIndex": 1, "demand": 4, "serviceMinutes": 5, "windowStartMinutes": 0, "windowEndMinutes": 80},
                    {"id": "s2", "locationIndex": 2, "demand": 6, "serviceMinutes": 5, "windowStartMinutes": 0, "windowEndMinutes": 80},
                ],
                "distanceMatrix": [[0, 10, 20], [10, 0, 10], [20, 10, 0]],
                "durationMatrix": [[0, 10, 20], [10, 0, 10], [20, 10, 0]],
                "timeLimitSeconds": 1,
            }
        )
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"))
        self.assertEqual(set(result["routes"][0]["stopIds"]), {"s1", "s2"})
        self.assertTrue(all(item["satisfied"] for item in result["constraints"]))

    def test_returns_infeasible_for_capacity_violation(self):
        result = solve_routes(
            {
                "requestId": "infeasible",
                "locations": [{"id": "depot"}, {"id": "a"}],
                "vehicles": [{"id": "v1", "capacity": 1, "maxMinutes": 10}],
                "stops": [{"id": "s1", "locationIndex": 1, "demand": 2, "windowEndMinutes": 5}],
                "distanceMatrix": [[0, 1], [1, 0]],
                "durationMatrix": [[0, 1], [1, 0]],
                "timeLimitSeconds": 1,
            }
        )
        self.assertEqual(result["status"], "INFEASIBLE")

    def test_rejects_unbounded_contract(self):
        with self.assertRaises(ContractError):
            solve_routes({"requestId": "bad", "locations": []})


class LoadSolverTest(unittest.TestCase):
    def test_honors_weight_and_unloading_order(self):
        result = solve_load(
            {
                "requestId": "load-test",
                "containers": [{"id": "truck", "maxWeight": 100, "maxVolume": 100, "bayCount": 4, "maxCgOffset": 300}],
                "items": [
                    {"id": "first", "weight": 10, "volume": 10, "unloadSequence": 1},
                    {"id": "second", "weight": 10, "volume": 10, "unloadSequence": 2},
                ],
                "timeLimitSeconds": 1,
            }
        )
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"))
        bays = {item["itemId"]: item["bay"] for item in result["placements"]}
        self.assertLessEqual(bays["first"], bays["second"])


if __name__ == "__main__":
    unittest.main()

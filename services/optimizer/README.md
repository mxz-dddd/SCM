# SCM OR-Tools optimizer sidecar

This service is intentionally stateless. It has no database credentials, tenant
context, callbacks, or outbound integration. The NestJS control domain owns job
state, audit, idempotency, result immutability, and domain events.

Runtime pins:

- Base image: `python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7`
- Debian packages are upgraded to the current Bookworm security level during
  the image build.
- Solver: `ortools==9.15.6755`
- Every transitive Python package is exact-version pinned in `requirements.txt`.

Narrow JSON API:

- `GET /health`
- `POST /v1/solve/routes`: depot/location matrices, mandatory stops, vehicle
  capacity, time windows, service time, driver-hours limit, and fixed cost.
- `POST /v1/solve/load`: containers with discrete bays plus item weight, volume,
  center-of-gravity tolerance, incompatibility, and unloading sequence.

Both solve endpoints accept at most 2 MB and enforce bounded collection sizes.
Responses contain the request ID, exact solver version, feasibility, assignments,
evaluated hard constraints, objective value, and a concise explanation. They do
not contain or infer SCM domain state.

Build and test:

```bash
docker build -t scm-optimizer:9.15.6755 services/optimizer
docker run --rm \
  -v "$PWD/services/optimizer/test_server.py:/opt/scm-optimizer/test_server.py:ro" \
  --entrypoint python scm-optimizer:9.15.6755 \
  -m unittest -v test_server.py
```

CREATE TYPE "control"."ControlRouteOptimizationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "control"."ControlLoadOptimizationStatus" AS ENUM ('QUEUED', 'RUNNING', 'PROPOSED', 'CONFIRMED', 'REJECTED', 'FAILED');
CREATE TYPE "control"."ControlForecastStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "control"."ControlRecommendationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "control"."ControlNetworkScenarioStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'ARCHIVED');

CREATE TABLE "control"."route_optimization" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlRouteOptimizationStatus" NOT NULL DEFAULT 'QUEUED',
  "job_run_id" UUID,
  "request_hash" CHAR(64) NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "objective_snapshot" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(100),
  CONSTRAINT "route_optimization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control"."route_optimization_result" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "optimization_id" UUID NOT NULL,
  "solver" VARCHAR(100) NOT NULL,
  "solver_version" VARCHAR(100) NOT NULL,
  "feasibility" VARCHAR(30) NOT NULL,
  "objective_value" DECIMAL(30,6),
  "route_snapshot" JSONB NOT NULL,
  "constraint_snapshot" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "result_hash" CHAR(64) NOT NULL,
  CONSTRAINT "route_optimization_result_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control"."load_optimization_result" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlLoadOptimizationStatus" NOT NULL DEFAULT 'QUEUED',
  "job_run_id" UUID,
  "request_hash" CHAR(64) NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "placement_snapshot" JSONB NOT NULL,
  "constraint_snapshot" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "solver_version" VARCHAR(100) NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(100),
  "confirmed_at" TIMESTAMPTZ(3),
  "confirmed_by" UUID,
  "decision_reason" VARCHAR(1000),
  "actual_deviation_snapshot" JSONB,
  "deviation_recorded_at" TIMESTAMPTZ(3),
  CONSTRAINT "load_optimization_result_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control"."demand_forecast" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlForecastStatus" NOT NULL DEFAULT 'DRAFT',
  "series_key" VARCHAR(300) NOT NULL,
  "version_number" INTEGER NOT NULL,
  "dimension_snapshot" JSONB NOT NULL,
  "training_from" TIMESTAMPTZ(3) NOT NULL,
  "training_to" TIMESTAMPTZ(3) NOT NULL,
  "horizon" INTEGER NOT NULL,
  "granularity" VARCHAR(30) NOT NULL,
  "model_version" VARCHAR(100) NOT NULL,
  "confidence_level" DECIMAL(8,6) NOT NULL,
  "point_snapshot" JSONB NOT NULL,
  "metric_snapshot" JSONB NOT NULL,
  "actual_deviation_snapshot" JSONB,
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "demand_forecast_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control"."inventory_policy_recommendation" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlRecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
  "forecast_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3),
  "decided_at" TIMESTAMPTZ(3),
  "decided_by" UUID,
  "decision_reason" VARCHAR(1000),
  CONSTRAINT "inventory_policy_recommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control"."network_scenario" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlNetworkScenarioStatus" NOT NULL DEFAULT 'DRAFT',
  "scenario_no" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "baseline_snapshot" JSONB NOT NULL,
  "change_snapshot" JSONB NOT NULL,
  "baseline_scenario_id" UUID,
  "job_run_id" UUID,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(100),
  CONSTRAINT "network_scenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control"."simulation_result" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "scenario_id" UUID NOT NULL,
  "metric_snapshot" JSONB NOT NULL,
  "comparison_snapshot" JSONB NOT NULL,
  "export_snapshot" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "result_hash" CHAR(64) NOT NULL,
  CONSTRAINT "simulation_result_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "control_route_optimization_status_idx" ON "control"."route_optimization"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "control_route_optimization_job_key" ON "control"."route_optimization"("tenant_id", "job_run_id");
CREATE INDEX "control_route_optimization_result_created_idx" ON "control"."route_optimization_result"("tenant_id", "created_at");
CREATE UNIQUE INDEX "control_route_optimization_result_key" ON "control"."route_optimization_result"("tenant_id", "optimization_id");
CREATE INDEX "control_load_optimization_status_idx" ON "control"."load_optimization_result"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "control_load_optimization_job_key" ON "control"."load_optimization_result"("tenant_id", "job_run_id");
CREATE INDEX "control_demand_forecast_series_idx" ON "control"."demand_forecast"("tenant_id", "series_key", "status", "created_at");
CREATE UNIQUE INDEX "control_demand_forecast_version_key" ON "control"."demand_forecast"("tenant_id", "series_key", "version_number");
CREATE INDEX "control_inventory_recommendation_lookup_idx" ON "control"."inventory_policy_recommendation"("tenant_id", "warehouse_id", "product_id", "status", "created_at");
CREATE INDEX "control_network_scenario_status_idx" ON "control"."network_scenario"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "control_network_scenario_no_key" ON "control"."network_scenario"("tenant_id", "scenario_no");
CREATE UNIQUE INDEX "control_network_scenario_job_key" ON "control"."network_scenario"("tenant_id", "job_run_id");
CREATE INDEX "control_simulation_result_created_idx" ON "control"."simulation_result"("tenant_id", "created_at");
CREATE UNIQUE INDEX "control_simulation_result_scenario_key" ON "control"."simulation_result"("tenant_id", "scenario_id");

CREATE FUNCTION "control"."reject_ai_result_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI optimization results are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "control"."guard_route_optimization"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."input_snapshot" IS DISTINCT FROM OLD."input_snapshot"
    OR NEW."objective_snapshot" IS DISTINCT FROM OLD."objective_snapshot" THEN
    RAISE EXCEPTION 'route optimization request snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "control"."guard_load_optimization"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."input_snapshot" IS DISTINCT FROM OLD."input_snapshot"
    OR (OLD."status" NOT IN ('QUEUED', 'RUNNING') AND (
      NEW."placement_snapshot" IS DISTINCT FROM OLD."placement_snapshot"
      OR NEW."constraint_snapshot" IS DISTINCT FROM OLD."constraint_snapshot"
      OR NEW."explanation" IS DISTINCT FROM OLD."explanation"))
    OR (OLD."actual_deviation_snapshot" IS NOT NULL AND NEW."actual_deviation_snapshot" IS DISTINCT FROM OLD."actual_deviation_snapshot") THEN
    RAISE EXCEPTION 'load optimization evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "control"."guard_forecast"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."series_key" IS DISTINCT FROM OLD."series_key"
    OR NEW."version_number" IS DISTINCT FROM OLD."version_number"
    OR NEW."dimension_snapshot" IS DISTINCT FROM OLD."dimension_snapshot"
    OR NEW."training_from" IS DISTINCT FROM OLD."training_from"
    OR NEW."training_to" IS DISTINCT FROM OLD."training_to"
    OR NEW."model_version" IS DISTINCT FROM OLD."model_version"
    OR NEW."point_snapshot" IS DISTINCT FROM OLD."point_snapshot"
    OR NEW."metric_snapshot" IS DISTINCT FROM OLD."metric_snapshot" THEN
    RAISE EXCEPTION 'demand forecast version evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "control"."guard_inventory_recommendation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."forecast_id" IS DISTINCT FROM OLD."forecast_id"
    OR NEW."product_id" IS DISTINCT FROM OLD."product_id"
    OR NEW."warehouse_id" IS DISTINCT FROM OLD."warehouse_id"
    OR NEW."input_snapshot" IS DISTINCT FROM OLD."input_snapshot"
    OR NEW."policy_snapshot" IS DISTINCT FROM OLD."policy_snapshot" THEN
    RAISE EXCEPTION 'inventory policy recommendation evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "control"."guard_network_scenario"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."scenario_no" IS DISTINCT FROM OLD."scenario_no"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."baseline_snapshot" IS DISTINCT FROM OLD."baseline_snapshot"
    OR NEW."change_snapshot" IS DISTINCT FROM OLD."change_snapshot"
    OR NEW."baseline_scenario_id" IS DISTINCT FROM OLD."baseline_scenario_id" THEN
    RAISE EXCEPTION 'network scenario input snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "control_route_optimization_guard" BEFORE UPDATE OR DELETE ON "control"."route_optimization" FOR EACH ROW EXECUTE FUNCTION "control"."guard_route_optimization"();
CREATE TRIGGER "control_route_result_immutable" BEFORE UPDATE OR DELETE ON "control"."route_optimization_result" FOR EACH ROW EXECUTE FUNCTION "control"."reject_ai_result_mutation"();
CREATE TRIGGER "control_load_optimization_guard" BEFORE UPDATE OR DELETE ON "control"."load_optimization_result" FOR EACH ROW EXECUTE FUNCTION "control"."guard_load_optimization"();
CREATE TRIGGER "control_demand_forecast_guard" BEFORE UPDATE OR DELETE ON "control"."demand_forecast" FOR EACH ROW EXECUTE FUNCTION "control"."guard_forecast"();
CREATE TRIGGER "control_inventory_recommendation_guard" BEFORE UPDATE OR DELETE ON "control"."inventory_policy_recommendation" FOR EACH ROW EXECUTE FUNCTION "control"."guard_inventory_recommendation"();
CREATE TRIGGER "control_network_scenario_guard" BEFORE UPDATE OR DELETE ON "control"."network_scenario" FOR EACH ROW EXECUTE FUNCTION "control"."guard_network_scenario"();
CREATE TRIGGER "control_simulation_result_immutable" BEFORE UPDATE OR DELETE ON "control"."simulation_result" FOR EACH ROW EXECUTE FUNCTION "control"."reject_ai_result_mutation"();

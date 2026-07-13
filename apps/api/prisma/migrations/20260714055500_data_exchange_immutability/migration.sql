CREATE TRIGGER import_row_error_immutable
BEFORE UPDATE OR DELETE ON "platform"."import_row_error"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

CREATE TRIGGER search_query_immutable
BEFORE UPDATE OR DELETE ON "platform"."search_query"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

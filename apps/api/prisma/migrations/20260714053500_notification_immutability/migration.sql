CREATE TRIGGER notification_read_immutable
BEFORE UPDATE OR DELETE ON "platform"."notification_read"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

CREATE TRIGGER delivery_attempt_immutable
BEFORE UPDATE OR DELETE ON "platform"."delivery_attempt"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

-- calls: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.calls where started_at >= :from and started_at < :to;

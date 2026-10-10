-- qualified: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.enquiries where outcome in ('QUALIFIED','QUALIFIED_WITH_NOTES') and created_at >= :from and created_at < :to;

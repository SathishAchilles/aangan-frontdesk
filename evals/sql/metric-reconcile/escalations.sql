-- escalations: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.handoffs where escalated_at is not null and posted_at >= :from and posted_at < :to;

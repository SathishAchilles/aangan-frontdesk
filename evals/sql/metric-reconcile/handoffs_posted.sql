-- handoffs_posted: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.handoffs where posted_at >= :from and posted_at < :to;

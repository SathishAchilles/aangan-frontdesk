-- callbacks_on_time: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.tasks where kind = 'callback' and created_at >= :from and created_at < :to and done_at <= due_at;

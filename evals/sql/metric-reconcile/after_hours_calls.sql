-- after_hours_calls: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.calls where direction = 'in' and started_at >= :from and started_at < :to
  and not (extract(isodow from started_at + interval '5 hours 30 minutes') between 1 and 5
  and (started_at + interval '5 hours 30 minutes')::time >= time '10:00'
  and (started_at + interval '5 hours 30 minutes')::time < time '19:00');

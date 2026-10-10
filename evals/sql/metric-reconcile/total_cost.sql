-- total_cost: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select (select coalesce(sum(amount_inr),0) from S.cost_lines where recorded_at >= :from and recorded_at < :to) + (select coalesce(sum(amount_inr),0) from S.fixed_costs where month = date '2026-09-01') v;

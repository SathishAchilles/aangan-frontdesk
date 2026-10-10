-- lost: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.enquiries where consult_result = 'lost' and created_at >= :from and created_at < :to;

-- booked: independent of src/lib/dashboard/metrics.ts. S. = schema, :from/:to = IST range bounds.
select count(*) v from S.enquiries e where created_at >= :from and created_at < :to and exists (select 1 from S.bookings b where b.enquiry_id = e.id and b.status <> 'cancelled');

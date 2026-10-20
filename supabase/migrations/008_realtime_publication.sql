-- Enable instant Supabase Postgres change notifications for authorized subscribers.
-- Existing row-level security policies continue to protect the appointment data.
do $$
declare table_name text;
begin
 foreach table_name in array array['appointments','availability','services'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
   execute format('alter publication supabase_realtime add table public.%I',table_name);
  end if;
 end loop;
end $$;
-- Public booking uses read-only RPCs; the five-second refresh fallback remains
-- because private appointment changes are not exposed to anonymous visitors.

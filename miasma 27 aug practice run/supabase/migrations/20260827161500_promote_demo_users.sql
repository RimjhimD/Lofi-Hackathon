-- Promote the three demo users (created via the auth admin API) to their roles.
-- Runs as postgres: RLS and the privilege guard trigger do not apply here.
update public.profiles set role = 'admin', approved = true
  where id = (select id from auth.users where email = 'admin@relieflens.demo');
update public.profiles set role = 'commissioner', approved = true
  where id = (select id from auth.users where email = 'commissioner@relieflens.demo');
update public.profiles set role = 'volunteer', approved = true
  where id = (select id from auth.users where email = 'volunteer@relieflens.demo');

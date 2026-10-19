-- 로컬 PostgreSQL에서 마이그레이션·RLS를 시험하기 위한 최소 Supabase 흉내 (실제 Supabase에는 적용하지 않는다)
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
-- Supabase와 같이 PostgREST가 넣어 주는 JWT 클레임(request.jwt.claims)의 sub를 읽는다
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')
  ), '')::uuid
$$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema extensions, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;

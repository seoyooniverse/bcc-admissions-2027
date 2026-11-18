create table if not exists public.consultation_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('booking', 'callback')),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  major text not null check (major in ('media', 'webtoon')),
  applicant_name text not null,
  phone text not null,
  applicant_role text not null check (applicant_role in ('student', 'parent')),
  question text not null default '',
  consultation_date date,
  consultation_time text,
  consultation_method text,
  callback_time text,
  callback_method text,
  source text not null default 'direct',
  sms_status text not null default 'pending' check (sms_status in ('pending', 'sent', 'failed', 'skipped')),
  sms_group_id text,
  constraint booking_has_slot check (
    (kind = 'booking' and consultation_date is not null and consultation_time is not null)
    or (kind = 'callback' and consultation_date is null and consultation_time is null)
  )
);

create unique index if not exists consultation_confirmed_slot_unique
  on public.consultation_requests (consultation_date, consultation_time)
  where kind = 'booking' and status = 'confirmed';

create index if not exists consultation_date_status_idx
  on public.consultation_requests (consultation_date, status);

create table if not exists public.consultation_rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  request_count integer not null,
  primary key (ip_hash, window_start)
);

create or replace function public.submit_consultation(p_application jsonb, p_ip_hash text)
returns uuid language plpgsql as $$
declare
  attempts integer;
  new_id uuid;
begin
  insert into public.consultation_rate_limits (ip_hash, window_start, request_count)
  values (p_ip_hash, date_trunc('hour', now()), 1)
  on conflict (ip_hash, window_start)
  do update set request_count = public.consultation_rate_limits.request_count + 1
  returning request_count into attempts;

  if attempts > 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.consultation_requests (
    kind, major, applicant_name, phone, applicant_role, question,
    consultation_date, consultation_time, consultation_method,
    callback_time, callback_method, source
  ) values (
    p_application->>'kind', p_application->>'major', p_application->>'applicant_name',
    p_application->>'phone', p_application->>'applicant_role', p_application->>'question',
    (p_application->>'consultation_date')::date, p_application->>'consultation_time',
    p_application->>'consultation_method', p_application->>'callback_time',
    p_application->>'callback_method', p_application->>'source'
  ) returning id into new_id;

  return new_id;
end;
$$;

alter table public.consultation_requests enable row level security;
alter table public.consultation_rate_limits enable row level security;
revoke all on public.consultation_requests from anon, authenticated;
revoke all on public.consultation_rate_limits from anon, authenticated;
revoke all on function public.submit_consultation(jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_consultation(jsonb, text) to service_role;

-- Supabase Cron: delete personal data after the disclosed 180-day period.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'bcc-delete-expired-consultations',
  '0 3 * * *',
  $$delete from public.consultation_requests where created_at < now() - interval '180 days'$$
);
select cron.schedule(
  'bcc-delete-expired-rate-limits',
  '15 3 * * *',
  $$delete from public.consultation_rate_limits where window_start < now() - interval '48 hours'$$
);

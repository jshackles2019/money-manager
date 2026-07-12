alter table public.financial_webhook_events
  add column if not exists event_fingerprint text,
  add column if not exists webhook_id text;

create unique index if not exists financial_webhook_events_fingerprint_uidx
on public.financial_webhook_events(event_fingerprint)
where event_fingerprint is not null;

alter table public.financial_webhook_events enable row level security;

create policy "financial_webhook_events_admin_read"
on public.financial_webhook_events
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

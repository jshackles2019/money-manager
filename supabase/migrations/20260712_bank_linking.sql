create extension if not exists pgcrypto;

create table if not exists public.financial_items (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_item_id text not null,
  institution_name text,
  institution_id text,
  access_token_ciphertext text not null,
  status text not null default 'connected',
  accounts_count integer not null default 0,
  cursor text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_item_id)
);

create table if not exists public.financial_accounts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id bigint not null references public.financial_items(id) on delete cascade,
  plaid_account_id text not null,
  name text not null,
  mask text,
  subtype text,
  type text,
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  iso_currency_code text,
  unofficial_currency_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_account_id)
);

create table if not exists public.financial_transactions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id bigint not null references public.financial_items(id) on delete cascade,
  plaid_transaction_id text not null,
  account_id bigint references public.financial_accounts(id) on delete set null,
  amount numeric(14,2) not null,
  date date not null,
  name text not null,
  merchant_name text,
  category jsonb,
  pending boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_transaction_id)
);

create table if not exists public.financial_transaction_links (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_transaction_id text not null,
  app_transaction_id bigint not null references public.transactions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, plaid_transaction_id)
);

create table if not exists public.financial_webhook_events (
  id bigserial primary key,
  item_id bigint references public.financial_items(id) on delete set null,
  plaid_item_id text,
  webhook_type text,
  webhook_code text,
  payload jsonb,
  processed_at timestamptz,
  status text not null default 'received',
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.financial_items enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_transaction_links enable row level security;

create policy "financial_items_select_own"
on public.financial_items
for select
using (auth.uid() = user_id);

create policy "financial_items_insert_own"
on public.financial_items
for insert
with check (auth.uid() = user_id);

create policy "financial_items_update_own"
on public.financial_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "financial_items_delete_own"
on public.financial_items
for delete
using (auth.uid() = user_id);

create policy "financial_accounts_select_own"
on public.financial_accounts
for select
using (auth.uid() = user_id);

create policy "financial_accounts_insert_own"
on public.financial_accounts
for insert
with check (auth.uid() = user_id);

create policy "financial_accounts_update_own"
on public.financial_accounts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "financial_accounts_delete_own"
on public.financial_accounts
for delete
using (auth.uid() = user_id);

create policy "financial_transactions_select_own"
on public.financial_transactions
for select
using (auth.uid() = user_id);

create policy "financial_transactions_insert_own"
on public.financial_transactions
for insert
with check (auth.uid() = user_id);

create policy "financial_transactions_update_own"
on public.financial_transactions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "financial_transactions_delete_own"
on public.financial_transactions
for delete
using (auth.uid() = user_id);

create policy "financial_transaction_links_select_own"
on public.financial_transaction_links
for select
using (auth.uid() = user_id);

create policy "financial_transaction_links_insert_own"
on public.financial_transaction_links
for insert
with check (auth.uid() = user_id);

create policy "financial_transaction_links_delete_own"
on public.financial_transaction_links
for delete
using (auth.uid() = user_id);

create index if not exists financial_items_user_idx
on public.financial_items(user_id, created_at desc);

create index if not exists financial_accounts_user_idx
on public.financial_accounts(user_id, plaid_account_id);

create index if not exists financial_transactions_user_idx
on public.financial_transactions(user_id, date desc);

create index if not exists financial_transaction_links_user_idx
on public.financial_transaction_links(user_id, plaid_transaction_id);

create index if not exists financial_webhook_events_item_idx
on public.financial_webhook_events(plaid_item_id, created_at desc);

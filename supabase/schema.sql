-- =====================================================================
-- Turbo Office — schema do Supabase
-- Rode este arquivo inteiro no Supabase: SQL Editor → New query → Run.
-- Pode rodar de novo sem problema (é idempotente).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- Perfis e cargos
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null check (char_length(name) between 1 and 32),
  color text not null default '#22d3ee' check (color ~ '^#[0-9a-fA-F]{6}$'),
  role text not null default 'membro' check (role in ('admin', 'gestor', 'membro')),
  created_at timestamptz not null default now()
);

create or replace function public.role_rank(r text) returns int
language sql immutable as $$
  select case r when 'admin' then 3 when 'gestor' then 2 when 'membro' then 1 else 0 end
$$;

create or replace function public.my_rank() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select role_rank(role) from profiles where id = auth.uid()), 0)
$$;

-- Só e-mails da Turbo podem criar conta. Para liberar outros domínios, edite a lista abaixo.
create or replace function public.check_email_domain() returns trigger
language plpgsql as $$
begin
  if lower(split_part(new.email, '@', 2)) not in ('turbopartners.com.br', 'turbopartners.com') then
    raise exception 'DOMINIO_NAO_PERMITIDO';
  end if;
  return new;
end $$;

drop trigger if exists turbo_check_domain on auth.users;
create trigger turbo_check_domain before insert or update of email on auth.users
  for each row execute function public.check_email_domain();

-- Cria o perfil no cadastro. A primeira pessoa a se cadastrar vira Admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare is_first boolean;
begin
  select not exists (select 1 from profiles) into is_first;
  insert into profiles (id, email, name, color, role) values (
    new.id,
    lower(new.email),
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)), 32),
    coalesce(substring(new.raw_user_meta_data->>'color' from '^#[0-9a-fA-F]{6}$'), '#22d3ee'),
    case when is_first then 'admin' else 'membro' end
  );
  return new;
end $$;

drop trigger if exists turbo_new_user on auth.users;
create trigger turbo_new_user after insert on auth.users
  for each row execute function public.handle_new_user();

-- Regras de edição do perfil: cada um edita nome/cor; só Admin muda cargo (e não o próprio).
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / service role
  if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at then
    raise exception 'Campo não editável';
  end if;
  if new.role <> old.role then
    if my_rank() < 3 then raise exception 'Só Admin pode mudar cargos'; end if;
    if old.id = auth.uid() then raise exception 'Você não pode mudar o próprio cargo'; end if;
  end if;
  if old.id <> auth.uid() and (new.name <> old.name or new.color <> old.color) then
    raise exception 'Só a própria pessoa edita o perfil';
  end if;
  return new;
end $$;

drop trigger if exists turbo_guard_profile on public.profiles;
create trigger turbo_guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or my_rank() = 3) with check (id = auth.uid() or my_rank() = 3);

-- ---------------------------------------------------------------- Salas
-- kind: 'text' (canal de texto) ou 'voice' (sala de voz/vídeo)
-- min_role: cargo mínimo para ver/entrar · write_role: cargo mínimo para escrever (texto)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('text', 'voice')),
  min_role text not null default 'membro' check (min_role in ('admin', 'gestor', 'membro')),
  write_role text not null default 'membro' check (write_role in ('admin', 'gestor', 'membro')),
  position int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated
  using (my_rank() >= role_rank(min_role));
drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert to authenticated
  with check (my_rank() >= 2 and role_rank(min_role) <= my_rank() and role_rank(write_role) <= my_rank());
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update to authenticated
  using (my_rank() >= 2 and my_rank() >= role_rank(min_role))
  with check (my_rank() >= 2 and role_rank(min_role) <= my_rank() and role_rank(write_role) <= my_rank());
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete to authenticated
  using (my_rank() >= 2 and my_rank() >= role_rank(min_role));

insert into public.rooms (name, kind, position, min_role, write_role)
select * from (values
  ('geral', 'text', 0, 'membro', 'membro'),
  ('avisos', 'text', 1, 'membro', 'gestor'),
  ('random', 'text', 2, 'membro', 'membro'),
  ('Lounge', 'voice', 10, 'membro', 'membro'),
  ('Tráfego', 'voice', 11, 'membro', 'membro'),
  ('Criativo', 'voice', 12, 'membro', 'membro'),
  ('CS', 'voice', 13, 'membro', 'membro'),
  ('Comercial', 'voice', 14, 'membro', 'membro'),
  ('Reunião 1', 'voice', 15, 'membro', 'membro'),
  ('Reunião 2', 'voice', 16, 'membro', 'membro'),
  ('Diretoria', 'voice', 17, 'gestor', 'gestor')
) as v(name, kind, position, min_role, write_role)
where not exists (select 1 from public.rooms);

-- ---------------------------------------------------------------- Mensagens
-- channel: 'room:<uuid da sala de texto>' ou 'dm:<uuid menor>:<uuid maior>'
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  channel text not null,
  from_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_channel_idx on public.messages (channel, id desc);

create or replace function public.can_read_channel(ch text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when ch like 'room:%' then exists (
      select 1 from rooms r where r.id::text = substring(ch from 6) and r.kind = 'text' and my_rank() >= role_rank(r.min_role))
    when ch like 'dm:%' then auth.uid()::text in (split_part(ch, ':', 2), split_part(ch, ':', 3))
    else false
  end
$$;

create or replace function public.can_write_channel(ch text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when ch like 'room:%' then exists (
      select 1 from rooms r where r.id::text = substring(ch from 6) and r.kind = 'text'
        and my_rank() >= role_rank(r.min_role) and my_rank() >= role_rank(r.write_role))
    when ch like 'dm:%' then
      auth.uid()::text in (split_part(ch, ':', 2), split_part(ch, ':', 3))
      and split_part(ch, ':', 2) < split_part(ch, ':', 3)
      and exists (select 1 from profiles where id::text = split_part(ch, ':', 2))
      and exists (select 1 from profiles where id::text = split_part(ch, ':', 3))
    else false
  end
$$;

alter table public.messages enable row level security;
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (can_read_channel(channel));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (from_id = auth.uid() and can_write_channel(channel));
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (from_id = auth.uid() or (my_rank() >= 2 and channel like 'room:%'));

-- ---------------------------------------------------------------- Moderação
-- Gestor/Admin muta ou remove alguém de uma sala de voz. Só vale para cargos abaixo do seu.
create table if not exists public.mod_actions (
  id bigint generated always as identity primary key,
  target uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('mute', 'unmute', 'kick')),
  by_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.mod_actions enable row level security;
drop policy if exists mod_read on public.mod_actions;
create policy mod_read on public.mod_actions for select to authenticated
  using (target = auth.uid() or my_rank() >= 2);
drop policy if exists mod_insert on public.mod_actions;
create policy mod_insert on public.mod_actions for insert to authenticated
  with check (by_id = auth.uid() and my_rank() >= 2
    and my_rank() > (select role_rank(role) from profiles where id = target));

-- ---------------------------------------------------------------- Tempo real
do $$
declare t text;
begin
  foreach t in array array['profiles', 'rooms', 'messages', 'mod_actions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Canais privados: presença do escritório, caixa de entrada de cada pessoa e eventos do banco.
drop policy if exists turbo_rt_read on realtime.messages;
create policy turbo_rt_read on realtime.messages for select to authenticated using (
  realtime.topic() in ('turbo:lobby', 'turbo:db') or realtime.topic() = 'turbo:user:' || auth.uid()::text
);
drop policy if exists turbo_rt_write on realtime.messages;
create policy turbo_rt_write on realtime.messages for insert to authenticated with check (
  realtime.topic() = 'turbo:lobby' or realtime.topic() like 'turbo:user:%'
);

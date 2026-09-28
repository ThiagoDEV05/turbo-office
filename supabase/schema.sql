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
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles add constraint profiles_avatar_url_check check (avatar_url is null or avatar_url ~ '^https://[^\s"'')]+$');

-- Personalização do perfil ("Nitro" liberado para todos)
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists pronouns text;
alter table public.profiles add column if not exists banner_color text;
alter table public.profiles add column if not exists banner_color2 text;
alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists name_color text;
alter table public.profiles add column if not exists decoration text;
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_custom_check;
alter table public.profiles add constraint profiles_custom_check check (
  (bio is null or char_length(bio) <= 190)
  and (pronouns is null or char_length(pronouns) <= 40)
  and (banner_color is null or banner_color ~ '^#[0-9a-fA-F]{6}$')
  and (banner_color2 is null or banner_color2 ~ '^#[0-9a-fA-F]{6}$')
  and (name_color is null or name_color ~ '^#[0-9a-fA-F]{6}$')
  and (banner_url is null or banner_url ~ '^https://[^\s"'')]+$')
  and (decoration is null or decoration in ('neon', 'fogo', 'ouro', 'arco-iris', 'gelo', 'turbo'))
  and pg_column_size(prefs) <= 4000
);

-- Banimentos: quem está banido (até "until", ou para sempre se null) perde o acesso a tudo.
create table if not exists public.bans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  until timestamptz,
  reason text check (reason is null or char_length(reason) <= 200),
  by_id uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.role_rank(r text) returns int
language sql immutable as $$
  select case r when 'admin' then 3 when 'gestor' then 2 when 'membro' then 1 else 0 end
$$;

create or replace function public.greatest_role(a text, b text) returns text
language sql immutable as $$
  select case when role_rank(a) >= role_rank(b) then a else b end
$$;

-- Cargo de quem está fazendo a requisição (0 = sem acesso, inclusive se estiver banido)
create or replace function public.my_rank() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select role_rank(p.role) from profiles p
    where p.id = auth.uid()
      and not exists (select 1 from bans b where b.user_id = p.id and (b.until is null or b.until > now()))
  ), 0)
$$;

create or replace function public.rank_of(uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select role_rank(role) from profiles where id = uid), 0)
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
  -- Qualquer campo além do cargo só pode ser alterado pela própria pessoa
  if old.id <> auth.uid() and (to_jsonb(new) - 'role') is distinct from (to_jsonb(old) - 'role') then
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

-- ---------------------------------------------------------------- Categorias
-- Agrupam as salas (ex.: "👑 10 · LIDERANÇA"). min_role: cargo mínimo para ver a categoria.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  position int not null default 0,
  min_role text not null default 'membro' check (min_role in ('admin', 'gestor', 'membro')),
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated
  using (my_rank() >= role_rank(min_role));
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (my_rank() >= 2 and role_rank(min_role) <= my_rank());
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (my_rank() >= 2 and my_rank() >= role_rank(min_role))
  with check (my_rank() >= 2 and role_rank(min_role) <= my_rank());
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated
  using (my_rank() >= 2 and my_rank() >= role_rank(min_role));

-- ---------------------------------------------------------------- Salas
-- kind: 'text' (canal de texto) ou 'voice' (sala de voz/vídeo)
-- min_role: cargo mínimo para ver/entrar · write_role: cargo mínimo para escrever (texto)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('text', 'voice')),
  category_id uuid references public.categories(id) on delete set null,
  min_role text not null default 'membro' check (min_role in ('admin', 'gestor', 'membro')),
  write_role text not null default 'membro' check (write_role in ('admin', 'gestor', 'membro')),
  position int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Para bancos criados com a versão anterior deste arquivo
alter table public.rooms add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.rooms drop constraint if exists rooms_name_check;
alter table public.rooms add constraint rooms_name_check check (char_length(name) between 1 and 60);

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

-- ---------------------------------------------------------------- Estrutura inicial
-- Espelha o servidor "Performance Turbo". Só roda quando ainda não há categorias;
-- remove as salas-padrão de versões anteriores (as criadas por pessoas são mantidas).
-- Texto: ["nome", "cargo mínimo para escrever"] · Voz: "nome"
do $$
declare
  spec jsonb := $json$[
    {"name": "Canais de Texto", "role": "membro"},
    {"name": "Só os ADMs BB! 😜", "role": "admin", "voice": ["🧠 | 1v1"]},
    {"name": "⚙️ 00 · ADMINISTRAÇÃO", "role": "membro",
     "text": [["🔔・avisos", "gestor"], ["📁・materiais", "membro"], ["😂・memes", "membro"], ["💬・chat-geral", "membro"]]},
    {"name": "👑 10 · LIDERANÇA", "role": "membro",
     "voice": ["[LD] Rodrigo Padrão", "[LD] Glauber", "[LD] Ismael", "[LD] Alex", "[LD] Maria"]},
    {"name": "💼 20 · ACCOUNTS", "role": "membro",
     "voice": ["[AC] Victor Arpini", "[AC] Jonatas Cavalcante", "[AC] Renan Fortunato", "[AC] Aline Souza", "[AC] Gabriel Taufner", "[AC] Felipe Vassalo"]},
    {"name": "📊 30 · GESTORES", "role": "membro",
     "voice": ["[GT] Thiago Andrey", "[GT] Arthur Magno", "[GT] Thiago Martins", "[GT] Allan Eduardo", "[GT] Richard Meira", "[GT] Weverton Teto", "[GT] Gabriel Magno", "[GT] Bruna Teixeira", "[GT] Bruno Silva", "[GT] José Neto", "[GT] Matheus Alves", "[GT] Matheus Silva", "[GT] Bruno Cosendey"]},
    {"name": "📈 40 · GROWTH TURBO", "role": "membro",
     "voice": ["[GW] Lucas Pereira", "[GW] Ichino", "[GW] Caio Malini", "[GW] Esther", "[GW] Amanda", "[GW] Caramelo"]},
    {"name": "🎨 50 · DESIGN", "role": "membro",
     "voice": ["[DG] Bernardo Soroldani", "[DG] Leonardo Soares", "[DG] Wendel Azevedo", "[DG] João Lucas Negromonte", "[DG] Lucas Dallas", "[DG] Carlos Eduardo"]},
    {"name": "🔫 60 · CX/CS", "role": "membro"}
  ]$json$;
  cat jsonb;
  t jsonb;
  v text;
  cid uuid;
  i int := 0;
  j int;
begin
  if exists (select 1 from public.categories) then return; end if;
  delete from public.rooms where created_by is null;
  for cat in select * from jsonb_array_elements(spec) loop
    insert into public.categories (name, position, min_role) values (cat->>'name', i, cat->>'role') returning id into cid;
    j := 0;
    for t in select * from jsonb_array_elements(coalesce(cat->'text', '[]'::jsonb)) loop
      insert into public.rooms (name, kind, category_id, position, min_role, write_role)
        values (t->>0, 'text', cid, j, cat->>'role', public.greatest_role(cat->>'role', t->>1));
      j := j + 1;
    end loop;
    for v in select * from jsonb_array_elements_text(coalesce(cat->'voice', '[]'::jsonb)) loop
      insert into public.rooms (name, kind, category_id, position, min_role) values (v, 'voice', cid, j, cat->>'role');
      j := j + 1;
    end loop;
    i := i + 1;
  end loop;
end $$;

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
    when ch like 'dm:%' then my_rank() >= 1 and auth.uid()::text in (split_part(ch, ':', 2), split_part(ch, ':', 3))
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
      my_rank() >= 1 and auth.uid()::text in (split_part(ch, ':', 2), split_part(ch, ':', 3))
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
  action text not null check (action in ('mute', 'unmute', 'kick', 'move')),
  room_id uuid references public.rooms(id) on delete cascade,
  by_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.mod_actions add column if not exists room_id uuid references public.rooms(id) on delete cascade;
alter table public.mod_actions drop constraint if exists mod_actions_action_check;
alter table public.mod_actions add constraint mod_actions_action_check check (action in ('mute', 'unmute', 'kick', 'move'));

alter table public.mod_actions enable row level security;
drop policy if exists mod_read on public.mod_actions;
create policy mod_read on public.mod_actions for select to authenticated
  using (target = auth.uid() or my_rank() >= 2);
drop policy if exists mod_insert on public.mod_actions;
create policy mod_insert on public.mod_actions for insert to authenticated
  with check (by_id = auth.uid() and my_rank() >= 2
    and my_rank() > rank_of(target));

-- Banir/desbanir: Gestor+ e só quem tem cargo abaixo do seu.
alter table public.bans enable row level security;
drop policy if exists bans_read on public.bans;
create policy bans_read on public.bans for select to authenticated
  using (user_id = auth.uid() or my_rank() >= 2);
drop policy if exists bans_insert on public.bans;
create policy bans_insert on public.bans for insert to authenticated
  with check (my_rank() >= 2 and user_id <> auth.uid() and my_rank() > rank_of(user_id) and by_id = auth.uid());
drop policy if exists bans_update on public.bans;
create policy bans_update on public.bans for update to authenticated
  using (my_rank() >= 2 and my_rank() > rank_of(user_id))
  with check (my_rank() >= 2 and user_id <> auth.uid() and my_rank() > rank_of(user_id) and by_id = auth.uid());
drop policy if exists bans_delete on public.bans;
create policy bans_delete on public.bans for delete to authenticated
  using (my_rank() >= 2 and my_rank() > rank_of(user_id));

-- ---------------------------------------------------------------- Agenda (link iCal privado)
-- Só a própria pessoa lê/grava o link. Os outros só veem "Em reunião até HH:MM" (pela presença).
create table if not exists public.calendar_links (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  ics_url text not null check (char_length(ics_url) <= 1000 and ics_url ~ '^(https|webcal)://'),
  updated_at timestamptz not null default now()
);
alter table public.calendar_links enable row level security;
drop policy if exists calendar_own on public.calendar_links;
create policy calendar_own on public.calendar_links for all to authenticated
  using (user_id = auth.uid() and my_rank() >= 1) with check (user_id = auth.uid() and my_rank() >= 1);

-- ---------------------------------------------------------------- Permissões das tabelas
-- Explícitas para funcionar mesmo com "Automatically expose new tables" desligado.
-- Quem pode o quê, linha a linha, é decidido pelas políticas RLS acima.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.categories, public.rooms to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert on public.mod_actions to authenticated;
grant select, insert, update, delete on public.bans to authenticated;
grant select, insert, update, delete on public.calendar_links to authenticated;
revoke all on public.profiles, public.categories, public.rooms, public.messages, public.mod_actions, public.bans, public.calendar_links from anon;

-- ---------------------------------------------------------------- Fotos de perfil (Storage)
-- Bucket público "avatars"; cada pessoa só envia/apaga arquivos na pasta com o próprio id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists turbo_avatars_insert on storage.objects;
create policy turbo_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists turbo_avatars_update on storage.objects;
create policy turbo_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists turbo_avatars_delete on storage.objects;
create policy turbo_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists turbo_avatars_select on storage.objects;
create policy turbo_avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------- Tempo real
do $$
declare t text;
begin
  foreach t in array array['profiles', 'categories', 'rooms', 'messages', 'mod_actions', 'bans'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Canais privados: presença do escritório, caixa de entrada de cada pessoa e eventos do banco.
drop policy if exists turbo_rt_read on realtime.messages;
create policy turbo_rt_read on realtime.messages for select to authenticated using (
  public.my_rank() >= 1 and (realtime.topic() in ('turbo:lobby', 'turbo:db') or realtime.topic() = 'turbo:user:' || auth.uid()::text)
);
drop policy if exists turbo_rt_write on realtime.messages;
create policy turbo_rt_write on realtime.messages for insert to authenticated with check (
  public.my_rank() >= 1 and (realtime.topic() = 'turbo:lobby' or realtime.topic() like 'turbo:user:%')
);

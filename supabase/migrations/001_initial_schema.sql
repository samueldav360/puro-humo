-- PURO HUMO · Esquema inicial de producción
-- Ejecutar completo en Supabase > SQL Editor como propietario del proyecto.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 2 and 60),
  points bigint not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Integrante',
  role text not null default 'member' check (role in ('member','admin')),
  group_id uuid references public.groups(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  code_hash text not null unique,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  amount bigint not null check (amount <> 0),
  description text not null check (char_length(trim(description)) between 1 and 240),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 100),
  description text not null check (char_length(trim(description)) between 1 and 1200),
  reward_points bigint not null check (reward_points > 0),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.challenge_submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  submitted_by uuid not null references auth.users(id),
  note text not null default '' check (char_length(note) <= 1200),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (challenge_id, group_id)
);

create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 100),
  description text not null check (char_length(trim(description)) between 1 and 1200),
  starting_bid bigint not null check (starting_bid > 0),
  current_bid bigint not null check (current_bid > 0),
  leader_group_id uuid references public.groups(id) on delete restrict,
  winner_group_id uuid references public.groups(id) on delete restrict,
  status text not null default 'open' check (status in ('open','closed','awarded')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  amount bigint not null check (amount > 0),
  placed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_group on public.profiles(group_id);
create index if not exists idx_transactions_group_created on public.point_transactions(group_id, created_at desc);
create index if not exists idx_submissions_status on public.challenge_submissions(status, created_at desc);
create index if not exists idx_auctions_status on public.auctions(status, created_at desc);
create index if not exists idx_bids_auction_created on public.bids(auction_id, created_at desc);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin') $$;

create or replace function public.current_group_id()
returns uuid language sql stable security definer set search_path = public
as $$ select p.group_id from public.profiles p where p.user_id = auth.uid() $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'Integrante'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Activar RLS en todas las tablas que contienen información de participantes.
alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.group_invites enable row level security;
alter table public.point_transactions enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_submissions enable row level security;
alter table public.auctions enable row level security;
alter table public.bids enable row level security;

-- Lectura limitada: miembros solo ven su grupo y el staff puede ver toda la operación.
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated
using (public.is_admin() or id = public.current_group_id());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (public.is_admin() or user_id = auth.uid());

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to authenticated
using (public.is_admin() or active = true);

drop policy if exists submissions_read on public.challenge_submissions;
create policy submissions_read on public.challenge_submissions for select to authenticated
using (public.is_admin() or group_id = public.current_group_id());

drop policy if exists auctions_read on public.auctions;
create policy auctions_read on public.auctions for select to authenticated
using (public.is_admin() or status in ('open','closed','awarded'));

drop policy if exists transactions_read on public.point_transactions;
create policy transactions_read on public.point_transactions for select to authenticated
using (public.is_admin() or group_id = public.current_group_id());

drop policy if exists bids_read on public.bids;
create policy bids_read on public.bids for select to authenticated
using (public.is_admin() or group_id = public.current_group_id());

-- Las tablas de invitaciones y los saldos no tienen políticas de escritura directa.
-- Las operaciones sensibles pasan exclusivamente por funciones SECURITY DEFINER.
drop policy if exists challenges_admin_insert on public.challenges;
create policy challenges_admin_insert on public.challenges for insert to authenticated
with check (public.is_admin() and created_by = auth.uid());

drop policy if exists auctions_admin_insert on public.auctions;
create policy auctions_admin_insert on public.auctions for insert to authenticated
with check (public.is_admin() and created_by = auth.uid() and status = 'open' and leader_group_id is null and winner_group_id is null);

-- Un usuario solo puede unirse a un grupo con un código creado por el staff.
create or replace function public.join_group(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_group uuid; v_existing uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  select group_id into v_existing from public.profiles where user_id = auth.uid() for update;
  if v_existing is not null then raise exception 'Esta cuenta ya pertenece a un grupo.'; end if;
  select group_id into v_group from public.group_invites
  where active = true and code_hash = encode(extensions.digest(trim(p_invite_code), 'sha256'), 'hex')
  limit 1;
  if v_group is null then raise exception 'Código de grupo inválido.'; end if;
  update public.profiles set group_id = v_group where user_id = auth.uid();
  return v_group;
end;
$$;

create or replace function public.admin_create_group(p_name text, p_initial_points bigint, p_invite_code text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_group uuid;
begin
  if not public.is_admin() then raise exception 'Solo el staff puede crear grupos.'; end if;
  if p_initial_points < 0 or p_initial_points > 1000000000 then raise exception 'Saldo inicial inválido.'; end if;
  if char_length(trim(p_invite_code)) < 6 then raise exception 'El código debe tener al menos 6 caracteres.'; end if;
  insert into public.groups(name, points) values (trim(p_name), p_initial_points) returning id into v_group;
  insert into public.group_invites(group_id, code_hash, created_by)
  values (v_group, encode(extensions.digest(trim(p_invite_code), 'sha256'), 'hex'), auth.uid());
  if p_initial_points > 0 then
    insert into public.point_transactions(group_id, amount, description, created_by)
    values (v_group, p_initial_points, 'Saldo inicial', auth.uid());
  end if;
  return v_group;
end;
$$;

create or replace function public.admin_adjust_points(p_group_id uuid, p_amount bigint, p_reason text, p_direction integer)
returns void language plpgsql security definer set search_path = public
as $$
declare v_balance bigint; v_delta bigint;
begin
  if not public.is_admin() then raise exception 'Solo el staff puede modificar puntos.'; end if;
  if p_amount <= 0 or p_amount > 1000000000 or p_direction not in (-1,1) then raise exception 'Movimiento inválido.'; end if;
  select points into v_balance from public.groups where id = p_group_id for update;
  if not found then raise exception 'Grupo no encontrado.'; end if;
  v_delta := p_amount * p_direction;
  if v_balance + v_delta < 0 then raise exception 'El grupo no tiene saldo suficiente.'; end if;
  update public.groups set points = points + v_delta where id = p_group_id;
  insert into public.point_transactions(group_id, amount, description, created_by)
  values (p_group_id, v_delta, left(trim(coalesce(p_reason,'Ajuste administrativo')),240), auth.uid());
end;
$$;

create or replace function public.submit_challenge(p_challenge_id uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_group uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  v_group := public.current_group_id();
  if v_group is null then raise exception 'Tu cuenta aún no pertenece a un grupo.'; end if;
  if not exists(select 1 from public.challenges where id=p_challenge_id and active=true) then raise exception 'Este reto no está disponible.'; end if;
  insert into public.challenge_submissions(challenge_id,group_id,submitted_by,note)
  values(p_challenge_id,v_group,auth.uid(),left(coalesce(p_note,''),1200)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_challenge_submission(p_submission_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare v_sub public.challenge_submissions%rowtype; v_reward bigint;
begin
  if not public.is_admin() then raise exception 'Solo el staff puede revisar retos.'; end if;
  select * into v_sub from public.challenge_submissions where id=p_submission_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sub.status <> 'pending' then raise exception 'Esta solicitud ya fue revisada.'; end if;
  update public.challenge_submissions set status=case when p_approve then 'approved' else 'rejected' end, reviewed_by=auth.uid(), reviewed_at=now() where id=p_submission_id;
  if p_approve then
    select reward_points into v_reward from public.challenges where id=v_sub.challenge_id;
    update public.groups set points=points+v_reward where id=v_sub.group_id;
    insert into public.point_transactions(group_id,amount,description,created_by)
    values(v_sub.group_id,v_reward,'Recompensa: '||(select title from public.challenges where id=v_sub.challenge_id),auth.uid());
  end if;
end;
$$;

-- La oferta más alta reserva puntos inmediatamente. Si otro grupo supera la oferta,
-- se devuelve la reserva anterior y se bloquea la nueva dentro de la misma transacción.
create or replace function public.place_bid(p_auction_id uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare v_auction public.auctions%rowtype; v_group uuid; v_balance bigint;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  v_group := public.current_group_id();
  if v_group is null then raise exception 'Tu cuenta aún no pertenece a un grupo.'; end if;
  select * into v_auction from public.auctions where id=p_auction_id for update;
  if not found or v_auction.status <> 'open' then raise exception 'La subasta no está abierta.'; end if;
  if p_amount <= v_auction.current_bid then raise exception 'La oferta debe superar la oferta actual.'; end if;
  if v_auction.leader_group_id = v_group then raise exception 'Tu grupo ya tiene la oferta más alta.'; end if;
  if v_auction.leader_group_id is not null then
    update public.groups set points=points+v_auction.current_bid where id=v_auction.leader_group_id;
    insert into public.point_transactions(group_id,amount,description,created_by)
    values(v_auction.leader_group_id,v_auction.current_bid,'Reserva liberada por oferta superada',auth.uid());
  end if;
  select points into v_balance from public.groups where id=v_group for update;
  if v_balance < p_amount then raise exception 'Tu grupo no tiene humos disponibles suficientes.'; end if;
  update public.groups set points=points-p_amount where id=v_group;
  insert into public.point_transactions(group_id,amount,description,created_by)
  values(v_group,-p_amount,'Oferta reservada en subasta: '||v_auction.title,auth.uid());
  insert into public.bids(auction_id,group_id,amount,placed_by) values(p_auction_id,v_group,p_amount,auth.uid());
  update public.auctions set current_bid=p_amount,leader_group_id=v_group where id=p_auction_id;
end;
$$;

-- Auditoría de adjudicaciones. Los humos se descuentan al reservar la oferta ganadora.
create table if not exists public.auction_awards (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null unique references public.auctions(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  amount bigint not null check (amount > 0),
  awarded_by uuid not null references auth.users(id),
  awarded_at timestamptz not null default now()
);
alter table public.auction_awards enable row level security;
drop policy if exists auction_awards_read on public.auction_awards;
create policy auction_awards_read on public.auction_awards for select to authenticated
using (public.is_admin() or group_id = public.current_group_id());

create or replace function public.close_auction(p_auction_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_auction public.auctions%rowtype;
begin
  if not public.is_admin() then raise exception 'Solo el staff puede cerrar subastas.'; end if;
  select * into v_auction from public.auctions where id=p_auction_id for update;
  if not found or v_auction.status <> 'open' then raise exception 'La subasta no está abierta.'; end if;
  if v_auction.leader_group_id is null then
    update public.auctions set status='closed',closed_at=now() where id=p_auction_id;
  else
    update public.auctions set status='awarded',winner_group_id=leader_group_id,closed_at=now() where id=p_auction_id;
    insert into public.auction_awards(auction_id,group_id,amount,awarded_by)
    values(p_auction_id,v_auction.leader_group_id,v_auction.current_bid,auth.uid());
  end if;
end;
$$;

-- Revocar privilegios implícitos y conceder solo lo necesario.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Permisos de ejecución explícitos. No se concede escritura directa sobre saldos ni perfiles.
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.admin_create_group(text,bigint,text) to authenticated;
grant execute on function public.admin_adjust_points(uuid,bigint,text,integer) to authenticated;
grant execute on function public.submit_challenge(uuid,text) to authenticated;
grant execute on function public.review_challenge_submission(uuid,boolean) to authenticated;
grant execute on function public.place_bid(uuid,bigint) to authenticated;
grant execute on function public.close_auction(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_group_id() to authenticated;

-- Publicar cambios para sincronización en tiempo real entre dispositivos.
do $$
declare t text;
begin
  foreach t in array array['groups','profiles','challenges','challenge_submissions','auctions','point_transactions'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

grant select on public.groups, public.profiles, public.challenges, public.challenge_submissions,
  public.auctions, public.point_transactions, public.bids, public.auction_awards to authenticated;
grant insert on public.challenges, public.auctions to authenticated;

-- IMPORTANTE: después de crear la primera cuenta del organizador, copia su UUID desde
-- Authentication > Users y ejecuta manualmente en SQL Editor:
-- update public.profiles set role='admin' where user_id='UUID-DE-LA-CUENTA-DEL-ORGANIZADOR';
-- No permitas que los participantes ejecuten esta instrucción ni les compartas acceso SQL.

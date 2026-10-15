-- Contratapa · esquema de base de datos para Supabase
-- Pegá TODO este archivo en Supabase > SQL Editor > New query y tocá "Run".

-- ============ PERFILES ============
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "perfiles visibles para usuarios logueados" on public.profiles
  for select to authenticated using (true);
create policy "editar mi perfil" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Crea el perfil automáticamente al registrarse (usa el usuario elegido en el registro)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), new.raw_user_meta_data->>'username')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Chequear si un usuario está libre (se usa antes de registrarse)
create or replace function public.username_available(u text)
returns boolean language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.profiles where username = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ============ AMISTADES ============
create table if not exists public.friendships (
  requester uuid not null references public.profiles on delete cascade,
  addressee uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;

create policy "ver mis amistades" on public.friendships
  for select to authenticated using (auth.uid() in (requester, addressee));
create policy "enviar solicitud" on public.friendships
  for insert to authenticated with check (requester = auth.uid() and status = 'pending');
create policy "aceptar solicitud" on public.friendships
  for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid());
create policy "borrar amistad o solicitud" on public.friendships
  for delete to authenticated using (auth.uid() in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- ============ LIBROS ============
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null,
  author text,
  genre text,
  blurb text,
  cover_url text,
  isbn text,
  pages int,
  year int,
  rating int check (rating between 0 and 5),
  start_date date,
  end_date date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists books_user_idx on public.books (user_id);
alter table public.books enable row level security;

create policy "ver mis libros y los de mis amigos" on public.books
  for select to authenticated using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
create policy "cargar mis libros" on public.books
  for insert to authenticated with check (user_id = auth.uid());
create policy "editar mis libros" on public.books
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "borrar mis libros" on public.books
  for delete to authenticated using (user_id = auth.uid());

-- ============ RECOMENDACIONES ============
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null default auth.uid() references public.profiles on delete cascade,
  to_user uuid not null references public.profiles on delete cascade,
  title text not null,
  author text,
  genre text,
  blurb text,
  cover_url text,
  note text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.recommendations enable row level security;

create policy "ver recomendaciones enviadas y recibidas" on public.recommendations
  for select to authenticated using (auth.uid() in (from_user, to_user));
create policy "recomendar solo a amigos" on public.recommendations
  for insert to authenticated with check (from_user = auth.uid() and public.are_friends(auth.uid(), to_user));
create policy "marcar como leída" on public.recommendations
  for update to authenticated using (to_user = auth.uid()) with check (to_user = auth.uid());
create policy "borrar recomendación" on public.recommendations
  for delete to authenticated using (auth.uid() in (from_user, to_user));

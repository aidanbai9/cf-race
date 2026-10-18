-- Tournaments: single-elimination brackets of 1v1 races. Anyone with the join
-- code can join (no account); members are authorized by a per-tournament
-- token stored hashed here and raw in an httpOnly cookie. Each game is a pair
-- of universal sessions (kind 'tournament'), so replays reuse session logs.

alter table public.sessions drop constraint if exists sessions_kind_check;
alter table public.sessions add constraint sessions_kind_check
  check (kind in ('solo', 'duel', 'event', 'tournament'));

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  tick_lease timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  status text not null default 'lobby'
    check (status in ('lobby', 'running', 'finished')),
  champion_member_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.tournament_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  token_hash text not null unique,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  role text not null default 'participant'
    check (role in ('participant', 'spectator')),
  is_admin boolean not null default false,
  is_owner boolean not null default false,
  seed integer,
  kicked_at timestamptz,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index tournament_members_tournament_idx
  on public.tournament_members (tournament_id);
create unique index tournament_members_name_uniq
  on public.tournament_members (tournament_id, lower(name))
  where kicked_at is null;

alter table public.tournaments
  add constraint tournaments_champion_fkey foreign key (champion_member_id)
  references public.tournament_members (id) on delete set null;

-- One row per bracket slot. bracket 'third' is the 3rd/4th place match.
create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  bracket text not null default 'main' check (bracket in ('main', 'third')),
  round integer not null,
  slot integer not null,
  format text not null check (format in ('single', 'bo3', 'final')),
  game_sec integer not null,
  member_a uuid references public.tournament_members (id) on delete set null,
  member_b uuid references public.tournament_members (id) on delete set null,
  a_wins integer not null default 0,
  b_wins integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'live', 'done')),
  ready_deadline timestamptz,
  a_ready_at timestamptz,
  b_ready_at timestamptz,
  winner_member_id uuid references public.tournament_members (id) on delete set null,
  loser_member_id uuid references public.tournament_members (id) on delete set null,
  decided_by text check (decided_by in ('games', 'coinflip', 'bye', 'forfeit', 'admin')),
  coin jsonb,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, bracket, round, slot)
);
create index tournament_matches_tournament_idx
  on public.tournament_matches (tournament_id);

create table public.tournament_games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tournament_matches (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  game_no integer not null,
  problem_id text not null references public.problems (id),
  started_at timestamptz not null,
  ends_at timestamptz not null,
  sudden_death boolean not null default false,
  session_a uuid references public.sessions (id) on delete set null,
  session_b uuid references public.sessions (id) on delete set null,
  first_ac_at timestamptz,
  winner_member_id uuid references public.tournament_members (id) on delete set null,
  decided_by text check (decided_by in ('solve', 'coinflip', 'draw', 'forfeit', 'admin')),
  coin jsonb,
  finished_at timestamptz,
  unique (match_id, game_no)
);
create index tournament_games_tournament_idx on public.tournament_games (tournament_id);
create index tournament_games_session_a_idx on public.tournament_games (session_a);
create index tournament_games_session_b_idx on public.tournament_games (session_b);

alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_games enable row level security;

grant all on public.tournaments, public.tournament_members,
  public.tournament_matches, public.tournament_games to service_role;

-- First AC of a game wins it: stamp the session solved and claim the game in
-- one transaction so two simultaneous ACs can't both win.
create or replace function public.record_tournament_ac(
  p_session_id uuid,
  p_game_id uuid,
  p_member_id uuid,
  p_submitted_at timestamptz,
  p_solve_ms integer,
  p_lang text
) returns boolean
language plpgsql
as $$
begin
  -- Claim the game first: only the first AC before the game settles wins,
  -- and only the winner's session is marked solved.
  update public.tournament_games
    set first_ac_at = p_submitted_at,
        winner_member_id = p_member_id,
        decided_by = 'solve'
    where id = p_game_id
      and first_ac_at is null
      and finished_at is null;
  if not found then
    return false;
  end if;

  update public.sessions
    set outcome = 'solved', solve_ms = p_solve_ms, lang = p_lang
    where id = p_session_id
      and solve_ms is null;
  return true;
end;
$$;

grant execute on function public.record_tournament_ac(uuid, uuid, uuid, timestamptz, integer, text)
  to service_role;

create table users (
    id uuid primary key default gen_random_uuid(),
    email text unique not null,
    name text,
    profile_picture_url text,
    created_at timestamp default now()
);

create table tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete cascade,
    title text not null,
    description text,
    action_required boolean default false,
    created_at timestamp default now()
);

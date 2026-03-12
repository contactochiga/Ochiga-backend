-- Community comments + reactions tables

create table if not exists community_comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid not null references community_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  parent_comment_id uuid null references community_comments(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_community_comments_post_id on community_comments(post_id);
create index if not exists idx_community_comments_user_id on community_comments(user_id);
create index if not exists idx_community_comments_parent on community_comments(parent_comment_id);

create table if not exists community_reactions (
  id uuid default gen_random_uuid() primary key,
  post_id uuid null references community_posts(id) on delete cascade,
  comment_id uuid null references community_comments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null default 'like',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint community_reactions_target_chk check (
    (post_id is not null and comment_id is null) or
    (post_id is null and comment_id is not null)
  )
);

create unique index if not exists ux_community_reactions_post_user
  on community_reactions(post_id, user_id)
  where post_id is not null;

create unique index if not exists ux_community_reactions_comment_user
  on community_reactions(comment_id, user_id)
  where comment_id is not null;


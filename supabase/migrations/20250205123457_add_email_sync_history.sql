CREATE TABLE email_sync_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete cascade,
    last_sync_time timestamp not null default now(),
    emails_processed int not null default 0,
    tasks_created int not null default 0
);

-- Add index for faster lookups
CREATE INDEX idx_email_sync_user_time 
ON email_sync_history(user_id, last_sync_time); 
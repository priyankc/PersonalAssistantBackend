alter table users
add column refresh_token text; 

alter table users
add column refresh_token_expires_at timestamp;


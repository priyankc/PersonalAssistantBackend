ALTER TABLE user_tasks
ADD COLUMN email_id text;

-- Add a unique constraint to prevent duplicate tasks for the same email
ALTER TABLE user_tasks
ADD CONSTRAINT unique_user_email 
UNIQUE (user_id, email_id);
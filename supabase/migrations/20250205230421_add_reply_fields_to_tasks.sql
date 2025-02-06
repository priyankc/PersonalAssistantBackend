-- Add new columns for email reply functionality
ALTER TABLE user_tasks
ADD COLUMN action_type text,
ADD COLUMN draft_reply text,
ADD COLUMN reply_status text CHECK (reply_status IN ('pending', 'approved', 'sent')),
ADD COLUMN thread_id text;

-- Add an index on thread_id since we'll be querying by it
CREATE INDEX idx_user_tasks_thread_id ON user_tasks(thread_id);

-- Add comment to explain the reply_status values
COMMENT ON COLUMN user_tasks.reply_status IS 'Status of email reply: pending (waiting for approval), approved (ready to send), sent (reply has been sent)';

export interface EmailHeader {
  name: string;
  value: string;
}

export interface FormattedEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  threadId: string;
  analysis?: EmailAnalysis;
}

export interface EmailAnalysis {
  actionNeeded: boolean;
  actionType?: string;
  actionDescription?: string;
  priority: 'high' | 'medium' | 'low' | 'skip';
  reason?: string;
}

export interface UserTask {
  user_id: string;
  title: string;
  description: string;
  action_required: boolean;
  email_id: string;
  created_at: string;
  action_type?: string;
  draft_reply?: string;
  reply_status?: 'pending' | 'approved' | 'sent';
  thread_id?: string;
} 
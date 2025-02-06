import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { UserTask } from './types.ts'
import * as dotenv from "https://deno.land/x/dotenv@v3.2.2/mod.ts"

// Load environment variables
dotenv.config()

const supabase = createClient(
  Deno.env.get('PROJECT_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!
)

const SUPABASE_URL = Deno.env.get('PROJECT_URL')!
const SUPABASE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

export async function getLastSyncTime(userId: string): Promise<Date> {
  const { data, error } = await supabase
    .from('email_sync_history')
    .select('last_sync_time')
    .eq('user_id', userId)
    .order('last_sync_time', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - 20);
    return defaultDate;
  }

  return new Date(data.last_sync_time);
}

export async function updateSyncHistory(
  userId: string, 
  emailsProcessed: number, 
  tasksCreated: number
): Promise<void> {
  await supabase
    .from('email_sync_history')
    .insert({
      user_id: userId,
      emails_processed: emailsProcessed,
      tasks_created: tasksCreated
    });
}

export async function createTasksFromEmails(
  userId: string, 
  actionableEmails: any[]
): Promise<number> {
  try {
    const tasks: UserTask[] = actionableEmails
      .filter(email => email.analysis?.actionNeeded && email.analysis?.actionType)
      .map(email => {
        const isReply = email.analysis!.actionType.toLowerCase() === 'reply';
        return {
          user_id: userId,
          title: `${email.analysis!.actionType}: ${email.subject}`,
          description: `From: ${email.from}\nDate: ${email.date}\n\nAction Required: ${email.analysis!.actionDescription}\n\nEmail Preview: ${email.snippet}`,
          action_required: true,
          email_id: email.id,
          action_type: email.analysis!.actionType.toLowerCase(),
          draft_reply: isReply ? email.analysis!.draftReply : null,
          reply_status: isReply ? 'pending' : null,
          thread_id: email.threadId
        };
      });

    if (tasks.length === 0) return 0;

    let createdCount = 0;
    for (const task of tasks) {
      const { error } = await supabase
        .from('user_tasks')
        .insert([task]);

      if (!error) createdCount++;
    }

    return createdCount;
  } catch (error) {
    throw new Error(`Failed to create tasks: ${error.message}`);
  }
}

export async function testDBConnection() {
  try {
    // First try a basic fetch to the health endpoint
    const healthCheck = await fetch(`${SUPABASE_URL}/rest/v1/health`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY
      }
    });
    console.log('Health check response:', await healthCheck.text());

    // If health check passes, try the Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data, error } = await supabase
      .from('user_tasks')
      .select('*')
      .limit(1);

    if (error) throw error;
    
    console.log('DB Connection Success:', data);
    return data;
  } catch (error) {
    console.error('DB Connection Error:', {
      message: error.message,
      details: error,
      url: SUPABASE_URL,
      hasKey: !!SUPABASE_KEY
    });
    throw error;
  }
}
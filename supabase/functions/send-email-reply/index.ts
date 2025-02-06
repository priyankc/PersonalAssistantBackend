import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import * as dotenv from "https://deno.land/x/dotenv@v3.2.2/mod.ts"

// Load environment variables
dotenv.config()

const supabase = createClient(
  Deno.env.get('PROJECT_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!
)

async function sendGmailReply(threadId: string, replyContent: string, accessToken: string) {
  const message = {
    threadId,
    raw: btoa(
      `Content-Type: text/plain; charset="UTF-8"\n` +
      `MIME-Version: 1.0\n` +
      `Content-Transfer-Encoding: 7bit\n\n` +
      `${replyContent}`
    ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message)
  })

  if (!response.ok) {
    throw new Error('Failed to send email reply')
  }

  return response.json()
}

serve(async (req) => {
  try {
    const { taskId } = await req.json()

    // Get task details
    const { data: task, error: taskError } = await supabase
      .from('user_tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskError || !task || task.action_type !== 'reply' || task.reply_status !== 'approved') {
      return new Response(
        JSON.stringify({ error: 'Invalid task or task not approved' }),
        { status: 400 }
      )
    }

    // Get user's Gmail access token
    const { data: auth, error: authError } = await supabase
      .from('user_auth')
      .select('access_token')
      .eq('user_id', task.user_id)
      .single()

    if (authError || !auth?.access_token) {
      return new Response(
        JSON.stringify({ error: 'Failed to get user auth token' }),
        { status: 400 }
      )
    }

    // Send the reply
    await sendGmailReply(task.thread_id!, task.draft_reply!, auth.access_token)

    // Update task status
    await supabase
      .from('user_tasks')
      .update({ reply_status: 'sent' })
      .eq('id', taskId)

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    )
  }
})

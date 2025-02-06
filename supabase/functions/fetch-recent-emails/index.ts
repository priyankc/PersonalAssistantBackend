import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import * as dotenv from "https://deno.land/x/dotenv@v3.2.2/mod.ts"
import { getLastSyncTime, updateSyncHistory, createTasksFromEmails } from './db.ts'
import { verifyGoogleToken, fetchEmails, processBatchOfEmails } from './gmail.ts'

// Load environment variables
dotenv.config()

const supabase = createClient(
  Deno.env.get('PROJECT_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!
)

serve(async (req: Request) => {
  try {
    console.log('🔵 Received request:', req.method, req.url)
    
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
        }
      })
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const { access_token, user_id } = await req.json()

    if (!access_token || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      )
    }

    // Verify the Google token
    await verifyGoogleToken(access_token)

    // Get last sync time
    const lastSyncTime = await getLastSyncTime(user_id)
    console.log('Last sync time:', lastSyncTime)

    // Fetch emails (will get last 100 emails)
    const { messages = [] } = await fetchEmails(access_token)
    console.log(`Found ${messages.length} emails to process`)

    // Process emails with date filtering
    const processedEmails = await processBatchOfEmails(messages, access_token, lastSyncTime)
    console.log(`Successfully processed ${processedEmails.length} emails since ${lastSyncTime ? lastSyncTime.toISOString() : 'one week ago'}`)

    // Create tasks from actionable emails
    const tasksCreated = await createTasksFromEmails(user_id, processedEmails)

    // Update sync history
    await updateSyncHistory(user_id, processedEmails.length, tasksCreated)

    return new Response(
      JSON.stringify({
        success: true,
        emailsProcessed: processedEmails.length,
        tasksCreated
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})

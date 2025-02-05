import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import * as dotenv from "https://deno.land/x/dotenv@v3.2.2/mod.ts"
import { FormattedEmail, EmailHeader } from './types.ts'
import { getLastSyncTime, updateSyncHistory, createTasksFromEmails, testDBConnection } from './db.ts'
import { analyzeEmailWithGPT4 } from './email-analyzer.ts'

// Load environment variables
dotenv.config()

const PROJECT_URL = Deno.env.get('PROJECT_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

console.log('Environment variables loaded:', {
  hasProjectUrl: !!PROJECT_URL,
  hasServiceRoleKey: !!SERVICE_ROLE_KEY,
  hasGoogleClientId: !!GOOGLE_CLIENT_ID,
  hasOpenAIAPIKey: !!OPENAI_API_KEY
})

const supabase = createClient(
  Deno.env.get('PROJECT_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!
)

async function verifyGoogleToken(accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`
  )
  if (!response.ok) {
    throw new Error('Invalid or expired access token')
  }
  return response.json()
}

async function fetchEmails(accessToken: string) {
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100',
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  )
  if (!response.ok) {
    throw new Error('Failed to fetch emails')
  }
  return response.json()
}

async function fetchEmailDetails(messageId: string, accessToken: string) {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(`Gmail API error: ${data.error?.message || response.statusText}`)
    }

    if (!data.payload?.headers) {
      console.error('Malformed email response:', data)
      throw new Error(`Missing headers in email response for message ${messageId}`)
    }

    return data
  } catch (error) {
    console.error(`Failed to fetch email ${messageId}:`, error)
    throw error
  }
}

const getHeader = (headers: any[], name: string) => {
  const header = headers.find(
    (h: { name: string, value: string }) => 
      h.name.toLowerCase() === name.toLowerCase()
  )
  return header ? header.value : ''
}

serve(async (req: Request) => {
  try {
    console.log('🔵 Received request:', req.method, req.url)
    
    // Handle GET request
    if (req.method === 'GET') {
      try {
        const result = await testDBConnection();
        return new Response(
          JSON.stringify({ 
            message: 'DB connection test',
            result,
            status: 'ok' 
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      } catch (error) {
        return new Response(
          JSON.stringify({ 
            error: error.message,
            details: error
          }),
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json' } 
          }
        )
      }
    }

    // Handle POST request
    if (req.method === 'POST') {
      const { user_id, access_token } = await req.json()
      
      if (!user_id || !access_token) {
        throw new Error('User ID and access token are required')
      }

      await verifyGoogleToken(access_token)
      const lastSyncTime = await getLastSyncTime(user_id)
      const emails = await fetchEmails(access_token)
      
      const emailDetails: FormattedEmail[] = await Promise.all(
        (emails.messages || []).map(async (message: { id: string }) => {
          try {
            const detail = await fetchEmailDetails(message.id, access_token)
            const headers = detail.payload.headers

            const getHeader = (name: string) => {
              const header = headers.find(
                (h: { name: string, value: string }) => 
                  h.name.toLowerCase() === name.toLowerCase()
              )
              return header?.value || ''
            }

            const subject = getHeader('subject')
            const from = getHeader('from')
            const date = getHeader('date')

            if (!subject || !from || !date) {
              console.warn(`Skipping email ${message.id} due to missing required fields`)
              return null
            }

            const formattedEmail: FormattedEmail = {
              id: detail.id,
              subject,
              from: from.replace(/<.*>/, '').trim(),
              date: new Date(date).toLocaleString(),
              snippet: detail.snippet || '',
              analysis: await analyzeEmailWithGPT4({
                id: detail.id,
                subject,
                from,
                date,
                snippet: detail.snippet || ''
              })
            }

            return formattedEmail
          } catch (error) {
            console.error(`Failed to process email ${message.id}:`, error)
            return null
          }
        })
      ).then(emails => emails.filter((email): email is FormattedEmail => email !== null))

      const priorityOrder = { high: 0, medium: 1, low: 2, skip: 3 }
      const actionableEmails = emailDetails
        .filter(email => email.analysis?.priority !== 'skip')
        .sort((a, b) => 
          priorityOrder[a.analysis?.priority || 'skip'] - 
          priorityOrder[b.analysis?.priority || 'skip']
        )

      const tasksCreated = await createTasksFromEmails(user_id, actionableEmails)
      await updateSyncHistory(user_id, emailDetails.length, tasksCreated)

      return new Response(
        JSON.stringify({
          syncInfo: {
            lastSync: lastSyncTime,
            emailsProcessed: emailDetails.length,
            tasksCreated
          },
          emails: actionableEmails
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Handle unsupported methods
    throw new Error('Method not allowed')

  } catch (error) {
    console.error('❌ Error in edge function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: error.message.includes('required') ? 400 : 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})

console.log('🚀 Edge Function is ready to receive requests') 
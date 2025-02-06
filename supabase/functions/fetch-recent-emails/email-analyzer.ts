import { FormattedEmail, EmailAnalysis } from './types.ts'

export async function analyzeEmailWithGPT4(email: FormattedEmail): Promise<EmailAnalysis> {
  const prompt = {
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an email assistant that analyzes emails and suggests actions. 
      Skip marketing, sales, and update emails. 
      For important emails, suggest specific actions like "reply", "schedule meeting", "follow up", etc.
      If action is 'reply', provide a draft reply that is professional and contextually appropriate.
      Provide brief, specific action descriptions when needed.
      
      For reply actions, format your response as:
      ACTION: reply
      PRIORITY: [priority]
      DRAFT_REPLY: [your suggested reply]
      REASON: [reason for reply]`
    }, {
      role: "user",
      content: `Analyze this email:
      From: ${email.from}
      Subject: ${email.subject}
      Preview: ${email.snippet}
      
      Determine if this needs action and what type. Return only important business or personal emails.`
    }]
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prompt)
    })

    if (!response.ok) {
      throw new Error('OpenAI API error')
    }

    const gptResponse = await response.json()
    const analysis = gptResponse.choices[0].message.content

    return parseAnalysis(analysis)
  } catch (error) {
    return {
      actionNeeded: false,
      priority: 'skip',
      reason: 'Error in analysis'
    }
  }
}

function parseAnalysis(analysis: string): EmailAnalysis {
  const isMarketing = /marketing|newsletter|promotion|update|sale/i.test(analysis)
  const hasAction = /should|need to|must|important|urgent|action required/i.test(analysis)
  const isMeeting = /meet|meeting|schedule|appointment/i.test(analysis)
  const isReply = /reply|respond|write back/i.test(analysis)
  const isHighPriority = /urgent|important|asap|immediate/i.test(analysis)

  if (isMarketing) {
    return {
      actionNeeded: false,
      priority: 'skip',
      reason: 'Marketing or promotional email'
    }
  }

  if (hasAction) {
    return {
      actionNeeded: true,
      actionType: isMeeting ? 'schedule_meeting' : isReply ? 'reply' : 'follow_up',
      actionDescription: analysis,
      priority: isHighPriority ? 'high' : 'medium'
    }
  }

  return {
    actionNeeded: false,
    priority: 'low',
    reason: 'No immediate action required'
  }
} 
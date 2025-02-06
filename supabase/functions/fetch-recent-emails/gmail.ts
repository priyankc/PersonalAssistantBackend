import { FormattedEmail, EmailHeader } from './types.ts'
import { analyzeEmailWithGPT4 } from './email-analyzer.ts'

export async function verifyGoogleToken(accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`
  )
  if (!response.ok) {
    throw new Error('Invalid or expired access token')
  }
  return response.json()
}

export async function fetchEmails(accessToken: string, lastSyncTime: Date | null = null) {
  try {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100';
    console.log('Fetching emails from URL:', url);

    const response = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gmail API Error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Gmail API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error in fetchEmails:', error);
    throw error;
  }
}

export async function fetchEmailDetails(messageId: string, accessToken: string, retryCount = 0) {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gmail API Error fetching email details:', {
        messageId,
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });

      // If rate limited (429) or server error (5xx), retry up to 3 times
      if ((response.status === 429 || response.status >= 500) && retryCount < 3) {
        const backoff = Math.pow(2, retryCount) * 1000; // Exponential backoff
        console.log(`Retrying fetch for message ${messageId} after ${backoff}ms (attempt ${retryCount + 1})`);
        await sleep(backoff);
        return fetchEmailDetails(messageId, accessToken, retryCount + 1);
      }

      throw new Error(`Gmail API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // Validate response structure
    if (!data?.payload?.headers) {
      console.error('Unexpected email details format:', data);
      throw new Error('Invalid email details format');
    }

    return data;
  } catch (error) {
    console.error(`Error fetching email ${messageId}:`, error);
    throw error;
  }
}

function getHeaderValue(headers: EmailHeader[], name: string): string {
  const header = headers.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  )
  return header?.value || ''
}

export async function processEmailDetail(detail: any, lastSyncTime: Date | null = null): Promise<FormattedEmail | null> {
  const headers = detail.payload.headers
  
  const subject = getHeaderValue(headers, 'subject')
  const from = getHeaderValue(headers, 'from')
  const date = getHeaderValue(headers, 'date')

  if (!subject || !from || !date) {
    console.warn(`Skipping email ${detail.id} due to missing required fields`)
    return null
  }

  const emailDate = new Date(date)
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

  // Skip emails older than lastSyncTime or one week
  if (lastSyncTime && emailDate < lastSyncTime) {
    console.log(`Skipping email ${detail.id} - older than last sync time`)
    return null
  } else if (!lastSyncTime && emailDate < oneWeekAgo) {
    console.log(`Skipping email ${detail.id} - older than one week`)
    return null
  }

  const formattedEmail: FormattedEmail = {
    id: detail.id,
    subject,
    from: from.replace(/<.*>/, '').trim(),
    date: emailDate.toLocaleString(),
    snippet: detail.snippet || '',
    threadId: detail.threadId,
    analysis: await analyzeEmailWithGPT4({
      id: detail.id,
      subject,
      from,
      date,
      snippet: detail.snippet || ''
    })
  }

  return formattedEmail
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function processBatchOfEmails(messages: any[], accessToken: string, lastSyncTime: Date | null = null): Promise<FormattedEmail[]> {
  const processedEmails: FormattedEmail[] = [];
  const BATCH_SIZE = 10;
  const OPENAI_RATE_LIMIT_DELAY = 2000; // 2 seconds between OpenAI API calls

  // Process messages in batches
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(messages.length / BATCH_SIZE)}`);

    // Process each email in the current batch
    for (const message of batch) {
      try {
        const detail = await fetchEmailDetails(message.id, accessToken);
        const formattedEmail = await processEmailDetail(detail, lastSyncTime);
        
        if (formattedEmail) {
          processedEmails.push(formattedEmail);
        }

        // Add delay between OpenAI API calls
        await sleep(OPENAI_RATE_LIMIT_DELAY);
      } catch (error) {
        console.error(`Failed to process email ${message.id}:`, error);
      }
    }

    // Add a small delay between batches to avoid Gmail API rate limits
    if (i + BATCH_SIZE < messages.length) {
      console.log('Waiting between batches...');
      await sleep(1000); // 1 second between batches
    }
  }

  return processedEmails;
}

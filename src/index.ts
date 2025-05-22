import express, { Request, Response } from 'express';
import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  Content,
  Part,
  FinishReason as GeminiFinishReason,
  SafetyRating,
  GenerateContentResponse,
  SafetySetting,
  GenerateContentConfig,
} from '@google/genai';

import mime from 'mime';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Helper function to fetch image and convert to base64
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64Data: string; mimeType: string }> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText} from URL: ${imageUrl}`);
    }
    const imageBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(imageBuffer).toString('base64');
    
    let detectedMimeType = response.headers.get('content-type');
    if (!detectedMimeType || !detectedMimeType.startsWith('image/')) {
      const typeFromUrl = mime.getType(imageUrl);
      if (typeFromUrl && typeFromUrl.startsWith('image/')) {
        detectedMimeType = typeFromUrl;
      } else {
        // Fallback or throw error if essential. Common types: image/jpeg, image/png, image/webp, etc.
        // Gemini example used image/png. Let's default to jpeg if truly unknown.
        console.warn(`Could not reliably determine MIME type for ${imageUrl}. Defaulting to image/jpeg.`);
        detectedMimeType = 'image/jpeg'; 
      }
    }
    return { base64Data, mimeType: detectedMimeType };
  } catch (error) {
    console.error(`Error fetching image ${imageUrl}:`, error);
    throw error; // Re-throw to be handled by the main error handler
  }
}


// Define new interfaces for OpenAI message content parts
interface OpenAIContentTextPart {
  type: 'text';
  text: string;
}

interface OpenAIContentImageUrlPart {
  type: 'image_url';
  image_url: {
    url: string;
    // detail?: string; // Optional, not used by Gemini in this way
  };
}

type OpenAIContentPart = OpenAIContentTextPart | OpenAIContentImageUrlPart;

// Modify OpenAIMessage interface
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[]; // Can be string or array of parts
}

interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
}

interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const mapGeminiFinishReasonToOpenAI = (reason: GeminiFinishReason | undefined): string => {
  if (!reason) return 'stop';
  switch (reason) {
    case GeminiFinishReason.STOP:
      return 'stop';
    case GeminiFinishReason.MAX_TOKENS:
      return 'length';
    case GeminiFinishReason.SAFETY:
      return 'content_filter';
    case GeminiFinishReason.RECITATION:
      return 'stop';
    case GeminiFinishReason.OTHER:
    default:
      return 'stop';
  }
};

app.post('/v1/chat/completions', async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Incoming request:`);
  console.log(`  Method: ${req.method}`);
  console.log(`  URL: ${req.originalUrl}`);
  console.log(`  Headers: ${JSON.stringify(req.headers, null, 2)}`);
  console.log(`  Body: ${JSON.stringify(req.body, null, 2)}`);


  const authHeader = req.headers.authorization;
  // ... existing API key handling ...
  let apiKey: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  }

  if (!apiKey) {
    res.status(401).json({ error: 'API key not provided or invalid format. Use Bearer token in Authorization header.' });
    return;
  }

  try {
    const requestBody = req.body as OpenAIChatCompletionRequest; // This will now use the new OpenAIMessage
    const { model: modelName, messages: openAIMessages, temperature } = requestBody;

    if (!modelName || !openAIMessages || !Array.isArray(openAIMessages)) {
      res.status(400).json({ error: 'Missing or invalid model or messages in request body' });
      return;
    }

    const genAI = new GoogleGenAI({ apiKey });

    const systemMessage = openAIMessages.find(msg => msg.role === 'system');
    let geminiSystemInstruction: Content | undefined = undefined;

    if (systemMessage) {
        if (typeof systemMessage.content === 'string') {
            geminiSystemInstruction = { parts: [{ text: systemMessage.content }], role: 'system' };
        } else {
            // Handle system message if it can also be complex (though typically it's string)
            // For now, assuming system message content is string as per common usage.
            // If system messages can also have image_url, this part would need expansion.
            console.warn("System message content is complex, only string content is currently processed for system instructions.");
            // Find first text part for system instruction if complex
            const firstTextPart = systemMessage.content.find(p => p.type === 'text') as OpenAIContentTextPart | undefined;
            if (firstTextPart) {
                 geminiSystemInstruction = { parts: [{ text: firstTextPart.text }], role: 'system' };
            }
        }
    }
    
    const geminiContents: Content[] = [];
    for (const openAIMsg of openAIMessages) {
      if (openAIMsg.role === 'system') continue; // System message handled separately

      const currentGeminiParts: Part[] = [];
      const imagePartsForGemini: Part[] = [];
      const textPartsForGemini: Part[] = [];

      if (typeof openAIMsg.content === 'string') {
        textPartsForGemini.push({ text: openAIMsg.content });
      } else { // Content is an array of OpenAIContentPart
        for (const part of openAIMsg.content) {
          if (part.type === 'text') {
            textPartsForGemini.push({ text: part.text });
          } else if (part.type === 'image_url') {
            try {
              const { base64Data, mimeType } = await fetchImageAsBase64(part.image_url.url);
              imagePartsForGemini.push({ inlineData: { data: base64Data, mimeType: mimeType } });
            } catch (e: any) {
              console.error(`Failed to process image URL ${part.image_url.url}: ${e.message}`);
              // Optionally, inform the client or skip this part. For now, logging and continuing.
              // Could also push an error text part: textPartsForGemini.push({ text: `[Error processing image: ${part.image_url.url}]` });
              res.status(400).json({ error: `Failed to process image from URL: ${part.image_url.url}. ${e.message}` });
              return;
            }
          }
        }
      }
      
      // Add image parts first, then text parts, as per user's Gemini example structure
      currentGeminiParts.push(...imagePartsForGemini);
      currentGeminiParts.push(...textPartsForGemini);

      if (currentGeminiParts.length > 0) {
        geminiContents.push({
          role: openAIMsg.role === 'assistant' ? 'model' : 'user',
          parts: currentGeminiParts,
        });
      }
    }
    
    if (geminiContents.length === 0 && !geminiSystemInstruction) {
        res.status(400).json({ error: 'No user/assistant messages or system instruction provided after processing.' });
        return;
    }

    // Use GenerateContentConfig for all configurations
    const geminiAPIConfig: GenerateContentConfig = {
      temperature: temperature ?? 0.9,
      responseMimeType: 'text/plain',
      // thinkingConfig: { thinkingBudget: 0 }, // From user example, include if desired
      safetySettings: [ // Default safety settings, user example had DANGEROUS_CONTENT only
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }, // User example: BLOCK_ONLY_HIGH
      ],
      systemInstruction: geminiSystemInstruction, // This is Content | undefined
    };
    // If user example's thinkingConfig is desired:
    if (geminiAPIConfig) { // Ensure geminiAPIConfig is not undefined if we add optional properties
        geminiAPIConfig.thinkingConfig = { thinkingBudget: 0 }; // As per user example
    }


    const result: GenerateContentResponse = await genAI.models.generateContent({
        model: modelName,
        contents: geminiContents,
        config: geminiAPIConfig, // Pass the combined config object
    });
    
    const geminiResponse = result; 

    // ... rest of the response processing and error handling ...
    if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
      console.error('No response or candidates from Gemini API:', JSON.stringify(geminiResponse, null, 2));
      const blockReason = geminiResponse?.promptFeedback?.blockReason;
      const safetyRatingsMapped = geminiResponse?.promptFeedback?.safetyRatings?.map((r: SafetyRating) => ({
        category: r.category,
        probability: r.probability,
        blocked: r.blocked,
      }));
      res.status(500).json({
        error: 'No content generated by the model.',
        blockReason: blockReason,
        safetyRatings: safetyRatingsMapped,
        fullGeminiResponse: geminiResponse 
      });
      return;
    }

    const candidate = geminiResponse.candidates[0];
    const fullText = (candidate.content && candidate.content.parts && candidate.content.parts.length > 0)
        ? candidate.content.parts.map((part: Part) => part.text).join('') // Note: if model returns mixed content, this only gets text
        : '';

    const finishReason = mapGeminiFinishReasonToOpenAI(candidate.finishReason);

    const responseId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
    const createdTimestamp = Math.floor(Date.now() / 1000);

    const promptTokens = geminiResponse.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = geminiResponse.usageMetadata?.candidatesTokenCount ?? (geminiResponse.usageMetadata as any)?.candidateTokenCount ?? 0;
    const totalTokens = geminiResponse.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

    const openAIResponse: OpenAIChatCompletionResponse = {
      id: responseId,
      object: 'chat.completion',
      created: createdTimestamp,
      model: modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: fullText,
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };

    res.json(openAIResponse);

  } catch (error: any) {
    console.error('Error processing request:', error.message, error.stack);
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    let errorDetails = error.message;

    if (error.name === 'GoogleGenerativeAIError' || error.constructor?.name === 'GoogleGenerativeAIError' || error.message?.includes('GoogleGenerativeAI')) { 
        errorMessage = 'Error from Google Gemini API';
        errorDetails = error.message;
        if (error.message?.toLowerCase().includes('api key not valid') || error.message?.toLowerCase().includes('api_key_invalid')) {
            statusCode = 401;
            errorMessage = 'Invalid Google Gemini API Key';
        }
    } else if (typeof error.status === 'number') {
        statusCode = error.status;
        errorMessage = error.message;
        errorDetails = error.details || error.message;
    } else if (error.response && typeof error.response.status === 'number' && error.response.data) { 
        statusCode = error.response.status;
        errorMessage = 'Error from downstream API';
        errorDetails = error.response.data;
    }
    
    res.status(statusCode).json({ error: errorMessage, details: errorDetails });
  }
});

app.listen(port, () => {
  console.log('Reverse proxy server listening on http://localhost:' + port);
});

// To run this server:
// 1. Ensure @google/genai, express, and mime are installed.
// 2. Run: npm run dev (or yarn dev, if your dev script in package.json is like "vite-node src/index.ts")
// 3. Send requests with "Authorization: Bearer YOUR_GEMINI_API_KEY" header.

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

// Helper function to fetch audio and convert to base64
async function fetchAudioAsBase64(audioUrl: string): Promise<{ base64Data: string; mimeType: string }> {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText} from URL: ${audioUrl}`);
    }
    const audioBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(audioBuffer).toString('base64');
    
    let detectedMimeType = response.headers.get('content-type');
    // Basic validation for audio MIME types
    if (!detectedMimeType || !detectedMimeType.startsWith('audio/')) {
      const typeFromUrl = mime.getType(audioUrl);
      if (typeFromUrl && typeFromUrl.startsWith('audio/')) {
        detectedMimeType = typeFromUrl;
      } else {
        console.warn(`Could not reliably determine MIME type for ${audioUrl}. Attempting to default based on extension or to a generic audio type.`);
        // Attempt to infer from common audio extensions if mime.getType failed or was not specific enough
        if (audioUrl.endsWith('.mp3')) detectedMimeType = 'audio/mpeg';
        else if (audioUrl.endsWith('.wav')) detectedMimeType = 'audio/wav';
        else if (audioUrl.endsWith('.ogg')) detectedMimeType = 'audio/ogg';
        else if (audioUrl.endsWith('.m4a')) detectedMimeType = 'audio/mp4'; // m4a is often audio/mp4
        else if (audioUrl.endsWith('.aac')) detectedMimeType = 'audio/aac';
        else if (audioUrl.endsWith('.flac')) detectedMimeType = 'audio/flac';
        else {
            // Fallback to a generic audio type if still unknown, though Gemini might prefer more specific types
            detectedMimeType = 'application/octet-stream'; // Or handle as an error
             console.warn(`Using fallback MIME type ${detectedMimeType} for ${audioUrl}. Specific audio type preferred.`);
        }
      }
    }
    return { base64Data, mimeType: detectedMimeType };
  } catch (error) {
    console.error(`Error fetching audio ${audioUrl}:`, error);
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

interface OpenAIContentAudioUrlPart {
  type: 'audio_url';
  audio_url: {
    url: string;
  };
}

type OpenAIContentPart = OpenAIContentTextPart | OpenAIContentImageUrlPart | OpenAIContentAudioUrlPart;

// Modify OpenAIMessage interface
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[]; // Can be string or array of parts
}

interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  // stream?: boolean; // Not yet supported
  // max_tokens?: number; // Not directly mapped, Gemini uses other limits
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'; // Added reasoning_effort
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
    const requestBody = req.body as OpenAIChatCompletionRequest;
    const { model: modelName, messages: openAIMessages, temperature, reasoning_effort } = requestBody; // Added reasoning_effort

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
      const mediaPartsForGemini: Part[] = []; // Combined for images and audio
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
              mediaPartsForGemini.push({ inlineData: { data: base64Data, mimeType: mimeType } });
            } catch (e: any) {
              console.error(`Failed to process image URL ${part.image_url.url}: ${e.message}`);
              res.status(400).json({ error: `Failed to process image from URL: ${part.image_url.url}. ${e.message}` });
              return;
            }
          } else if (part.type === 'audio_url') {
            try {
              const { base64Data, mimeType } = await fetchAudioAsBase64(part.audio_url.url);
              mediaPartsForGemini.push({ inlineData: { data: base64Data, mimeType: mimeType } });
            } catch (e: any) {
              console.error(`Failed to process audio URL ${part.audio_url.url}: ${e.message}`);
              res.status(400).json({ error: `Failed to process audio from URL: ${part.audio_url.url}. ${e.message}` });
              return;
            }
          }
        }
      }
      
      // Add media parts first (images, audio), then text parts
      currentGeminiParts.push(...mediaPartsForGemini);
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
      safetySettings: [ 
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      systemInstruction: geminiSystemInstruction,
    };

    // Handle reasoning_effort to set thinkingBudget
    let thinkingBudget = 0; // Default to 0 if not specified or "none"
    if (reasoning_effort) {
      switch (reasoning_effort) {
        case 'low':
          thinkingBudget = 1000;
          break;
        case 'medium':
          thinkingBudget = 8000;
          break;
        case 'high':
          thinkingBudget = 24000;
          break;
        case 'none':
          thinkingBudget = 0;
          break;
        default:
          // Log invalid value but proceed with default 0
          console.warn(`Invalid reasoning_effort value: ${reasoning_effort}. Defaulting to thinking budget 0.`);
          break;
      }
    }
    // Only add thinkingConfig if budget is explicitly set by reasoning_effort or if it was the previous default
    // The previous default was to always add thinkingBudget: 0. We will maintain this if no reasoning_effort is given.
    geminiAPIConfig.thinkingConfig = { thinkingBudget: thinkingBudget };

    const result: GenerateContentResponse = await genAI.models.generateContent({
        model: modelName,
        contents: geminiContents,
        config: geminiAPIConfig, // Pass the combined config object
    });
    
    const geminiResponse = result; 

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
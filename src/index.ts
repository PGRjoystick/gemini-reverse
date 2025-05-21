import express, { Request, Response } from 'express';
import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerationConfig,
  Content,
  Part,
  FinishReason as GeminiFinishReason,
  SafetyRating,
  GenerateContentResponse,
  SafetySetting,
  GenerateContentConfig,
} from '@google/genai';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
    const { model: modelName, messages: openAIMessages, temperature } = requestBody;

    if (!modelName || !openAIMessages || !Array.isArray(openAIMessages)) {
      res.status(400).json({ error: 'Missing or invalid model or messages in request body' });
      return;
    }

    const genAI = new GoogleGenAI({ apiKey });

    const systemMessage = openAIMessages.find(msg => msg.role === 'system');
    const geminiSystemInstruction: Content | undefined = systemMessage
      ? { parts: [{ text: systemMessage.content }], role: 'system' } 
      : undefined;

    const geminiContents: Content[] = openAIMessages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));
    
    if (geminiContents.length === 0 && !geminiSystemInstruction) {
        res.status(400).json({ error: 'No user/assistant messages or system instruction provided.' });
        return;
    }

    const geminiGenerationConfig: GenerateContentConfig = {
      temperature: temperature ?? 0.9,
      responseMimeType: 'text/plain',
      thinkingConfig: {
        thinkingBudget: 0,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
        },
      ],
      systemInstruction: geminiSystemInstruction,
    };

    // Corrected SDK usage: Call generateContent directly on genAI.models
    // All parameters (model, contents, generationConfig, safetySettings, systemInstruction) 
    // are passed in the single request object here.
    const result: GenerateContentResponse = await genAI.models.generateContent({
        model: modelName,
        contents: geminiContents,
        config: geminiGenerationConfig
    });
    
    const geminiResponse = result; // result is already the GenerateContentResponse

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
        ? candidate.content.parts.map((part: Part) => part.text).join('')
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

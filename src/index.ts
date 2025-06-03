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

import { fetchFileAsBase64, fetchImageAsBase64, resolveRedirects, processGeminiResponseParts, isGeminiImagePart, checkBucketServerHealth } from './utils';
import {
  OpenAIContentTextPart,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  mapGeminiFinishReasonToOpenAI
} from './types';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/v1/chat/completions', async (req: Request, res: Response): Promise<void> => {
  // Log incoming request details for debugging purposes
  console.log(`[${new Date().toISOString()}] Incoming request:`);
  // console.log(`  Method: ${req.method}`);
  // console.log(`  URL: ${req.originalUrl}`);
  // console.log(`  Headers: ${JSON.stringify(req.headers, null, 2)}`);
   console.log(`  Body: ${JSON.stringify(req.body, null, 2)}`);


  const authHeader = req.headers.authorization;
  let apiKey: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  } else {
    // Fallback to environment variable if no Authorization header
    apiKey = process.env.GEMINI_API_KEY;
  }

  if (!apiKey) {
    res.status(401).json({ 
      error: 'API key not provided. Use Bearer token in Authorization header or set GEMINI_API_KEY environment variable.' 
    });
    return;
  }

  try {
    const requestBody = req.body as OpenAIChatCompletionRequest;
    const { model: modelName, messages: openAIMessages, temperature, reasoning_effort, tools, modalities } = requestBody; // Added tools and modalities

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
      const mediaPartsForGemini: Part[] = [];
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
          } else if (part.type === 'file_url') {
            const url = part.file_url.url;
            const YOUTUBE_URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[&?][^\s]*)?$/i;
            if (YOUTUBE_URL_REGEX.test(url)) {
              // YouTube link: use fileData with fileUri and video/* mimeType
              mediaPartsForGemini.push({
                fileData: {
                  fileUri: url,
                  mimeType: 'video/*',
                }
              });
            } else {
              try {
                const { base64Data, mimeType } = await fetchFileAsBase64(url);
                mediaPartsForGemini.push({ inlineData: { data: base64Data, mimeType: mimeType } });
              } catch (e: any) {
                console.error(`Failed to process file URL ${url}: ${e.message}`);
                res.status(400).json({ error: `Failed to process file from URL: ${url}. ${e.message}` });
                return;
              }
            }
          }
        }
      }
      // Add media parts first (images, files), then text parts
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
      temperature: temperature ?? 1,
      responseMimeType: 'text/plain',
      safetySettings: [ 
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      systemInstruction: geminiSystemInstruction,
    };

    // Only add tools if provided in request
    if (tools && tools.length > 0) {
      geminiAPIConfig.tools = tools;
    }

    // Handle modalities parameter to set responseModalities
    if (modalities && Array.isArray(modalities) && modalities.length > 0) {
      const responseModalities: string[] = [];
      
      for (const modality of modalities) {
        if (typeof modality === 'string') {
          const upperModality = modality.toUpperCase();
          if (upperModality === 'TEXT') {
            responseModalities.push('TEXT');
          } else if (upperModality === 'IMAGE') {
            responseModalities.push('IMAGE');
          } else {
            console.warn(`Unsupported modality: ${modality}. Supported modalities are 'text' and 'image'.`);
          }
        }
      }
      
      if (responseModalities.length > 0) {
        geminiAPIConfig.responseModalities = responseModalities;
      }
    }

    // Handle reasoning_effort to set thinkingBudget
    // Only add thinkingConfig if reasoning_effort parameter is explicitly provided
    if (reasoning_effort) {
      let thinkingBudget = 0; // Default to 0 for "none" or invalid values
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
      geminiAPIConfig.thinkingConfig = { thinkingBudget: thinkingBudget };
    }
    // If reasoning_effort is not provided, thinkingConfig is not set at all

    const result: GenerateContentResponse = await genAI.models.generateContent({
        model: modelName,
        contents: geminiContents,
        config: geminiAPIConfig, // Pass the combined config object
    });
    
    const geminiResponse = result; 

    console.log('Gemini API response:', JSON.stringify(geminiResponse, null, 2));

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
    
    // Check if response contains mixed content (text + images)
    const hasMixedContent = candidate.content?.parts?.some((part: Part) => isGeminiImagePart(part));
    
    console.log(`Response analysis: ${candidate.content?.parts?.length || 0} parts, mixed content: ${hasMixedContent}`);
    if (hasMixedContent) {
      console.log('Parts breakdown:', candidate.content?.parts?.map((part, i) => ({
        index: i,
        hasText: !!part.text,
        hasImage: isGeminiImagePart(part),
        imageType: isGeminiImagePart(part) ? (part as any).inlineData?.mimeType : null
      })));
    }
    
    let responseContent: string | OpenAIContentPart[];
    
    if (hasMixedContent && candidate.content?.parts) {
      // Process mixed content with images
      console.log('Processing mixed content response with images');
      responseContent = await processGeminiResponseParts(candidate.content.parts);
    } else {
      // Traditional text-only response
      responseContent = (candidate.content && candidate.content.parts && candidate.content.parts.length > 0)
        ? candidate.content.parts.map((part: Part) => part.text).filter(Boolean).join('')
        : '';
    }

    const finishReason = mapGeminiFinishReasonToOpenAI(candidate.finishReason);

    const responseId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
    const createdTimestamp = Math.floor(Date.now() / 1000);

    const promptTokens = geminiResponse.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = geminiResponse.usageMetadata?.candidatesTokenCount ?? (geminiResponse.usageMetadata as any)?.candidateTokenCount ?? 0;
    const totalTokens = geminiResponse.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

    const groundingDataChunks = geminiResponse.candidates[0].groundingMetadata?.groundingChunks;

    // === Add: Resolve real URLs for groundingChunks and add google_gemini_body ===
    let googleGeminiBody: any = undefined;
    if (groundingDataChunks && Array.isArray(groundingDataChunks)) {
      // For each chunk, resolve the real URL and add as resolved_uri
      const resolvedChunks = await Promise.all(
        groundingDataChunks.map(async (chunk) => {
          if (chunk.web && chunk.web.uri) {
            const resolvedUri = await resolveRedirects(chunk.web.uri);
            return {
              ...chunk,
              web: {
                ...chunk.web,
                resolved_uri: resolvedUri,
              },
            };
          }
          return chunk;
        })
      );
      googleGeminiBody = {
        groundingMetadata: {
          groundingChunks: resolvedChunks,
        },
      };
    }

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
            content: responseContent,
          },
          finish_reason: finishReason,
          ...(googleGeminiBody ? { google_gemini_body: googleGeminiBody } : {}),
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
    console.error('Error details:', {
      name: error.name,
      constructor: error.constructor?.name,
      message: error.message,
      status: error.status
    });
    
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    let errorDetails = error.message;

    // Extract status code from Gemini API errors
    if (error.name === 'GoogleGenerativeAIError' || error.constructor?.name === 'GoogleGenerativeAIError' || error.message?.includes('GoogleGenerativeAI') || error.message?.includes('got status:')) { 
        errorMessage = 'Error from Google Gemini API';
        errorDetails = error.message;
        
        // Try to extract status code from error message patterns
        // Pattern 1: "got status: 429 Too Many Requests"
        const statusMatch = error.message?.match(/got status:\s*(\d+)/);
        console.log('Status match result:', statusMatch);
        if (statusMatch) {
            statusCode = parseInt(statusMatch[1], 10);
            console.log('Extracted status code from Pattern 1:', statusCode);
        } else {
            // Pattern 2: Look for JSON with "code" field in the error message
            const jsonMatch = error.message?.match(/\{"error":\{"code":(\d+),/);
            console.log('JSON match result:', jsonMatch);
            if (jsonMatch) {
                statusCode = parseInt(jsonMatch[1], 10);
                console.log('Extracted status code from Pattern 2:', statusCode);
            } else {
                // Pattern 3: Try to parse the entire JSON block if present
                try {
                    const jsonStart = error.message?.indexOf('{"error":');
                    if (jsonStart !== -1) {
                        const jsonStr = error.message.substring(jsonStart);
                        const jsonEnd = jsonStr.lastIndexOf('}') + 1;
                        const errorJson = JSON.parse(jsonStr.substring(0, jsonEnd));
                        console.log('Parsed error JSON:', errorJson);
                        if (errorJson.error && errorJson.error.code) {
                            statusCode = errorJson.error.code;
                            console.log('Extracted status code from Pattern 3:', statusCode);
                        }
                    }
                } catch (parseError) {
                    console.warn('Could not parse JSON from error message:', parseError);
                }
            }
        }
        
        // Handle specific API key errors
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
    
    console.log('Final status code being returned:', statusCode);
    res.status(statusCode).json({ error: errorMessage, details: errorDetails });
  }
});

app.listen(port, async () => {
  console.log('Reverse proxy server listening on http://localhost:' + port);
  
  // Check bucket server health on startup
  console.log('Checking bucket server availability...');
  const bucketHealthy = await checkBucketServerHealth();
  if (bucketHealthy) {
    console.log('✓ Bucket server is available for image uploads');
  } else {
    console.log('⚠ Bucket server not available - image uploads will fall back to data URLs');
  }
});
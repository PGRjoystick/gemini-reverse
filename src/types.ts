import { FinishReason as GeminiFinishReason } from '@google/genai';

// Define new interfaces for OpenAI message content parts
export interface OpenAIContentTextPart {
  type: 'text';
  text: string;
}

export interface OpenAIContentImageUrlPart {
  type: 'image_url';
  image_url: {
    url: string;
    // detail?: string; // Optional, not used by Gemini in this way
  };
}

export interface OpenAIContentFileUrlPart {
  type: 'file_url';
  file_url: {
    url: string;
  };
}

export type OpenAIContentPart = OpenAIContentTextPart | OpenAIContentImageUrlPart | OpenAIContentFileUrlPart;

// Modify OpenAIMessage interface
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[]; // Can be string or array of parts
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  // stream?: boolean; // Not yet supported
  // max_tokens?: number; // Not directly mapped, Gemini uses other limits
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'; // Added reasoning_effort
  tools?: Array<{ googleSearch?: {} }>; // Added tools support
  modalities?: string[]; // Added modalities support for mixed content generation
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | OpenAIContentPart[]; // Support mixed content for image generation
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Types for Gemini image generation responses
export interface GeminiImagePart {
  inlineData: {
    mimeType: string;
    data: string; // base64 encoded image
  };
}

export interface GeminiTextPart {
  text: string;
}

export type GeminiResponsePart = GeminiTextPart | GeminiImagePart;

// Image upload response from bucket server
export interface ImageUploadResponse {
  url: string;
  filename?: string;
  success: boolean;
  error?: string;
}

export const mapGeminiFinishReasonToOpenAI = (reason: GeminiFinishReason | undefined): string => {
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

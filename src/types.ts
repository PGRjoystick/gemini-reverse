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
  thinking_level?: 'minimal' | 'low' | 'medium' | 'high'; // Added thinking_level
  tools?: Array<{ googleSearch?: {} }>; // Added tools support
  modalities?: string[]; // Added modalities support for mixed content generation
  // Vertex AI configuration
  use_vertex?: boolean; // If true, use Google Cloud Vertex AI instead of Gemini AI
  google_cloud_project?: string; // Required when use_vertex is true
  google_cloud_location?: string; // Required when use_vertex is true (e.g., 'us-central1', 'global')
  // Context caching support
  cached_content?: string; // Cache resource name (e.g., 'projects/.../locations/.../cachedContents/...')
}

// Context Cache Types
export interface CacheContentPart {
  text?: string;
  file_data?: {
    mime_type: string;
    file_uri: string;
  };
  inline_data?: {
    mime_type: string;
    data: string; // base64 encoded
  };
}

export interface CacheContent {
  role: 'user' | 'model';
  parts: CacheContentPart[];
}

export interface CreateCacheRequest {
  model: string;
  display_name?: string;
  contents?: CacheContent[];
  system_instruction?: string;
  ttl?: string; // Duration string like "3600s" for 1 hour
  expire_time?: string; // ISO 8601 timestamp
  // Vertex AI configuration (required for cache operations)
  use_vertex?: boolean;
  google_cloud_project?: string;
  google_cloud_location?: string;
}

export interface UpdateCacheRequest {
  ttl?: string;
  expire_time?: string;
  // Vertex AI configuration
  use_vertex?: boolean;
  google_cloud_project?: string;
  google_cloud_location?: string;
}

export interface CacheResponse {
  name: string;
  model: string;
  display_name?: string;
  create_time: string;
  update_time: string;
  expire_time: string;
  usage_metadata?: {
    total_token_count: number;
  };
}

export interface ListCachesResponse {
  caches: CacheResponse[];
  next_page_token?: string;
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
    cached_content_token_count?: number; // Token count from cached content
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

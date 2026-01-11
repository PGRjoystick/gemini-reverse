# Copilot Instructions for gemini-reverse

## Project Overview

**gemini-reverse** is a reverse proxy server that translates OpenAI Chat Completion API requests to Google Gemini API calls. It enables applications using the OpenAI SDK or API format to seamlessly work with Google's Generative AI models without code changes.

### Core Purpose
- Convert OpenAI `/v1/chat/completions` requests to Google Gemini API format
- Handle response translation from Gemini format back to OpenAI format
- Support multimodal inputs (text, images, files, audio, YouTube videos)
- Support multimodal outputs (text and image generation)

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js 5.x
- **Build Tool**: vite-node (development)
- **Primary Dependencies**:
  - `@google/genai` - Google Generative AI SDK
  - `express` - HTTP server framework
  - `axios` - HTTP client for bucket uploads
  - `form-data` - Multipart form data handling
  - `mime` - MIME type detection
  - `dotenv` - Environment variable management

## Project Structure

```
gemini-reverse/
├── src/
│   ├── index.ts    # Main Express server and API endpoint
│   ├── types.ts    # TypeScript interfaces and type mappings
│   └── utils.ts    # Utility functions for file/image processing
├── tests/          # Test scripts
├── package.json
├── tsconfig.json
└── .env            # Environment configuration (not in repo)
```

## Architecture Patterns

### Request Flow
1. Receive OpenAI-formatted request at `/v1/chat/completions`
2. Extract API key from `Authorization: Bearer` header or `GEMINI_API_KEY` env var
3. Parse and validate OpenAI message format
4. Convert OpenAI messages to Gemini Content format
5. Handle multimodal content (images, files, URLs)
6. Call Google Gemini API
7. Convert Gemini response back to OpenAI format
8. Process any generated images (upload to bucket server)
9. Return OpenAI-compatible response

### Key Type Mappings

| OpenAI Concept | Gemini Equivalent |
|----------------|-------------------|
| `messages[].role: 'system'` | `systemInstruction` |
| `messages[].role: 'user'` | `contents[].role: 'user'` |
| `messages[].role: 'assistant'` | `contents[].role: 'model'` |
| `temperature` | `temperature` |
| `reasoning_effort` | `thinkingConfig.thinkingBudget` |
| `modalities` | `responseModalities` |
| `tools` | `tools` |

### Finish Reason Mapping
| Gemini FinishReason | OpenAI finish_reason |
|---------------------|---------------------|
| `STOP` | `stop` |
| `MAX_TOKENS` | `length` |
| `SAFETY` | `content_filter` |
| `RECITATION` | `stop` |
| `OTHER` | `stop` |

## Coding Guidelines

### TypeScript Conventions
- Use strict TypeScript (`"strict": true`)
- Define explicit interfaces for all API request/response structures
- Use type guards for runtime type checking (e.g., `isGeminiImagePart()`)
- Export types from `types.ts` for shared use

### Error Handling
- Extract HTTP status codes from Gemini API error messages
- Map Gemini errors to appropriate OpenAI-compatible error responses
- Log detailed error information for debugging
- Always return JSON error responses with `error` and `details` fields

### Async/Await Patterns
- Use `async/await` for all asynchronous operations
- Handle Promise rejections with try/catch blocks
- Use `Promise.all()` for parallel operations (e.g., resolving URLs)

### Logging
- Log request details with timestamps: `[${new Date().toISOString()}]`
- Log content type, content length, and user agent
- Log Gemini API responses for debugging
- Use `console.warn()` for non-fatal issues
- Use `console.error()` for errors

## API Request Format

### Supported OpenAI Parameters
```typescript
interface OpenAIChatCompletionRequest {
  model: string;                          // Gemini model name
  messages: OpenAIMessage[];              // Conversation messages
  temperature?: number;                   // 0.0 to 2.0
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none';
  tools?: Array<{ googleSearch?: {} }>;   // Tools array
  modalities?: string[];                  // ['text'], ['image'], or ['text', 'image']
  // Vertex AI configuration
  use_vertex?: boolean;                   // Use Google Cloud Vertex AI instead of Gemini AI
  google_cloud_project?: string;          // GCP project ID (required when use_vertex is true)
  google_cloud_location?: string;         // GCP region (required when use_vertex is true)
  // Context caching
  cached_content?: string;                // Cache resource name for explicit caching
}
```

### Context Caching Support
The server supports Gemini's context caching feature to reduce costs and latency for repeated content.

**Cache Management Endpoints:**
- `POST /v1/caches` - Create a new context cache
- `GET /v1/caches` - List all caches
- `GET /v1/caches/:id` - Get cache details
- `PATCH /v1/caches/:id` - Update cache TTL
- `DELETE /v1/caches/:id` - Delete a cache

**Using Cached Content:**
```typescript
// In chat completion request
{
  "model": "gemini-2.0-flash-001",
  "cached_content": "projects/123/locations/us-central1/cachedContents/abc",
  "messages": [...]
}
```

**Response includes cache metadata:**
```typescript
{
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "cached_content_token_count": 2048  // Tokens from cache
  }
}
```

### Message Content Types
```typescript
// Text content
{ type: 'text', text: string }

// Image content
{ type: 'image_url', image_url: { url: string } }

// File content (documents, audio, video)
{ type: 'file_url', file_url: { url: string } }
```

## Content Processing Rules

### Image Handling
- Fetch remote images and convert to base64
- Detect MIME type from response headers or URL extension
- Use magic number detection as fallback
- Default to `image/jpeg` if unable to determine type

### File Handling
- Support PDF, DOCX, XLSX, PPTX, legacy Office formats
- Use magic number detection for accurate MIME typing
- YouTube URLs are handled specially with `fileData.fileUri`

### YouTube URL Detection
```typescript
const YOUTUBE_URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[&?][^\s]*)?$/i;
```

### URL Transformation (Local Development)
Configure via environment variables:
- `TRANSFORM_SOURCE_HOSTNAME` - Hostname to transform
- `TRANSFORM_TARGET_HOSTNAME` - Target hostname (default: localhost)
- `TRANSFORM_TARGET_PORT` - Target port
- `TRANSFORM_TARGET_PROTOCOL` - Target protocol (default: http:)

## Image Generation Support

### Response Processing
- Check for `inlineData` parts with image MIME types
- Upload generated images to bucket server
- Fall back to data URLs if bucket server unavailable
- Return OpenAI-style mixed content format

### Bucket Server Integration
```env
BUCKET_API_URL=http://localhost:3003/upload
BUCKET_API_KEY=your_api_key
```

### Image Upload Flow
1. Detect `inlineData` with `mimeType.startsWith('image/')`
2. Convert base64 to Buffer
3. Create FormData with file
4. POST to bucket server
5. Extract URL from response (`fileUrl`, `url`, or string response)
6. Return as `image_url` content part

## Safety Settings

The proxy disables all Gemini safety filters by default:
```typescript
safetySettings: [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
]
```

## Reasoning Effort Mapping

| reasoning_effort | thinkingBudget |
|------------------|----------------|
| `none` | 0 |
| `low` | 1000 |
| `medium` | 8000 |
| `high` | 24000 |

Note: Only set `thinkingConfig` if `reasoning_effort` is explicitly provided.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `GEMINI_API_KEY` | Fallback API key | - |
| `BUCKET_API_URL` | Image upload endpoint | - |
| `BUCKET_API_KEY` | Bucket API authentication | - |
| `TRANSFORM_SOURCE_HOSTNAME` | URL transformation source | - |
| `TRANSFORM_TARGET_HOSTNAME` | URL transformation target | localhost |
| `TRANSFORM_TARGET_PORT` | URL transformation port | - |
| `TRANSFORM_TARGET_PROTOCOL` | URL transformation protocol | http: |

## Common Development Tasks

### Adding New Message Content Types
1. Add interface to `types.ts` (e.g., `OpenAIContentNewPart`)
2. Update `OpenAIContentPart` union type
3. Add handling in `index.ts` message processing loop
4. Add helper function in `utils.ts` if needed

### Adding New Request Parameters
1. Add property to `OpenAIChatCompletionRequest` interface
2. Destructure in `/v1/chat/completions` handler
3. Map to `GenerateContentConfig` object
4. Update README.md documentation

### Adding New Response Processing
1. Check for new content types in `candidate.content.parts`
2. Create type guard function (e.g., `isGeminiNewPart()`)
3. Add processing logic in `processGeminiResponseParts()`
4. Map to appropriate OpenAI content part format

## Testing

```bash
# Run development server
npm run dev

# Test image generation
npm run test:image-gen

# Test mixed content
npm run test:mixed-content

# Comprehensive tests
npm run test:comprehensive
```

## Error Response Format

```typescript
// Success response
{
  id: string,
  object: 'chat.completion',
  created: number,
  model: string,
  choices: [...],
  usage: { prompt_tokens, completion_tokens, total_tokens }
}

// Error response
{
  error: string,
  details: string
}
```

## Important Notes

1. **API Key Handling**: Prefer `Authorization: Bearer` header over env var
2. **Payload Limits**: Body parser configured for 50MB max
3. **Timeout Handling**: URL resolution has 5-second timeout
4. **Redirect Resolution**: Maximum 10 redirects followed
5. **MIME Type Detection**: Multi-layered approach (headers → URL → magic numbers)
6. **Grounding Metadata**: Includes resolved URLs for grounding chunks

## Code Style Preferences

- Use early returns for validation and error cases
- Prefer explicit type annotations on function parameters
- Use template literals for string interpolation
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Log important state changes and API interactions
- Use descriptive variable names that indicate content/purpose

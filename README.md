# gemini-reverse

A reverse proxy server that translates OpenAI chat completion API requests to Google Gemini API calls, supporting file attachments (images, documents, audio, YouTube videos), tools, reasoning effort, and proper error handling.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Support for text, image_url, and file_url message content parts
- **Image Generation Support**: Automatic processing of Gemini's base64 image outputs
  - Uploads generated images to configured bucket server
  - Returns OpenAI-style mixed content responses (text + image_url parts)
  - Supports streaming image generation responses
- YouTube video handling (sent as fileData with fileUri)
- Document support (PDF, DOCX, XLSX, PPTX, legacy MS Office formats)
- Image and audio file processing with automatic MIME type detection
- Tools parameter passthrough to Gemini API
- Reasoning effort support with thinkingBudget mapping
- Proper HTTP status code forwarding from Gemini API errors
- Configurable URL transformation for local development

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your settings:
   ```env
   # URL transformation settings for local development
   TRANSFORM_SOURCE_HOSTNAME=your-domain.com
   TRANSFORM_TARGET_HOSTNAME=localhost
   TRANSFORM_TARGET_PORT=3003
   TRANSFORM_TARGET_PROTOCOL=http:
   
   # Bucket server configuration for image uploads
   BUCKET_API_URL=http://localhost:3003/upload
   BUCKET_API_KEY=your_bucket_api_key_here
   
   # Your Gemini API key (optional if provided via Authorization header)
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. Start the server:
   ```bash
   npm run dev
   ```

## URL Transformation

The server can automatically transform URLs for local development. This is useful when you have a file server running locally but referenced by an external domain name. Configure the transformation in your `.env` file:

- `TRANSFORM_SOURCE_HOSTNAME`: The hostname to transform (e.g., `bucket.example.com`)
- `TRANSFORM_TARGET_HOSTNAME`: Target hostname (default: `localhost`)
- `TRANSFORM_TARGET_PORT`: Target port for the transformed URL

## Supported Request Parameters

The reverse proxy supports these OpenAI-compatible parameters:

- `model`: Gemini model name (e.g., `gemini-1.5-flash`, `gemini-1.5-pro`)
- `messages`: Array of conversation messages with support for text, images, and files
- `temperature`: Controls response randomness (0.0 to 2.0)
- `reasoning_effort`: Sets thinking budget for reasoning models (`low`, `medium`, `high`, `none`)
- `tools`: Array of tools (currently supports Google Search)
- `modalities`: Output modalities (`["text"]`, `["image"]`, or `["text", "image"]`)

### Vertex AI Support

The server supports both Google Gemini AI (default) and Google Cloud Vertex AI modes. To use Vertex AI, include these parameters in your request body:

- `use_vertex`: Set to `true` to use Vertex AI instead of Gemini AI
- `google_cloud_project`: Your Google Cloud project ID (required when `use_vertex` is `true`)
- `google_cloud_location`: The Google Cloud region (required when `use_vertex` is `true`, e.g., `us-central1`, `global`)

**Example Vertex AI Request:**

```json
{
  "model": "gemini-1.5-flash",
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "use_vertex": true,
  "google_cloud_project": "my-gcp-project",
  "google_cloud_location": "us-central1"
}
```

**Authentication for Vertex AI:**
When using Vertex AI mode, authentication is handled via **Google Cloud Application Default Credentials (ADC)** on the server, not via the API key in the request. The server must have valid Google Cloud credentials configured.

### Context Caching Support

Context caching helps reduce the cost and latency of requests that contain repeated content. The server supports both implicit caching (automatic) and explicit caching (manual).

#### Implicit Caching
Implicit caching is automatically enabled on supported Gemini models. You don't need to do anything special - just place large and common content at the beginning of your prompts.

#### Explicit Caching
For explicit control over caching, use the cache management endpoints:

**Create a Context Cache:**
```bash
curl -X POST http://localhost:3000/v1/caches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash-001",
    "display_name": "my-cache",
    "system_instruction": "You are an expert researcher...",
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "file_data": {
              "mime_type": "application/pdf",
              "file_uri": "gs://your-bucket/document.pdf"
            }
          }
        ]
      }
    ],
    "ttl": "3600s"
  }'
```

For Vertex AI mode, add these parameters:
```json
{
  "use_vertex": true,
  "google_cloud_project": "your-project-id",
  "google_cloud_location": "us-central1",
  ...
}
```

**Use a Cached Content in Chat:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash-001",
    "cached_content": "projects/123456/locations/us-central1/cachedContents/abc123",
    "messages": [
      {
        "role": "user",
        "content": "Summarize the document"
      }
    ]
  }'
```

**List Caches:**
```bash
curl http://localhost:3000/v1/caches \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY"
```

**Get Cache Details:**
```bash
curl http://localhost:3000/v1/caches/CACHE_ID \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY"
```

**Update Cache TTL:**
```bash
curl -X PATCH http://localhost:3000/v1/caches/CACHE_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY" \
  -d '{
    "ttl": "7200s"
  }'
```

**Delete a Cache:**
```bash
curl -X DELETE http://localhost:3000/v1/caches/CACHE_ID \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY"
```

#### Cache Response Metadata

When using cached content, the response includes `cached_content_token_count` in the usage metadata:

```json
{
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "cached_content_token_count": 2048
  }
}
```

#### Supported Models for Caching

- Gemini 3 Flash/Pro
- Gemini 2.5 Pro/Flash/Flash-Lite  
- Gemini 2.0 Flash/Flash-Lite

**Note:** Minimum cache size is 2,048 tokens. Maximum content size is 10MB.

**Setting up server credentials for Vertex AI:**

Option 1 - User credentials (for development):
```bash
gcloud auth application-default login
```

Option 2 - Service account (for production):
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

The service account needs the `Vertex AI User` role (`roles/aiplatform.user`) or equivalent permissions.

### Modalities Support

When requesting mixed content generation, specify the desired output modalities:

```json
{
  "model": "gemini-1.5-flash",
  "messages": [...],
  "modalities": ["text", "image"]
}
```

This maps to Gemini's `responseModalities` configuration and enables image generation capabilities.
- `TRANSFORM_TARGET_PROTOCOL`: Target protocol (default: `http:`)

Leave `TRANSFORM_SOURCE_HOSTNAME` empty to disable URL transformation.

## Usage

Send requests to `http://localhost:3000/v1/chat/completions` with your Gemini API key in the Authorization header:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY" \
  -d '{
    "model": "gemini-1.5-flash",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
```

### Image Generation

When using Gemini models that support image generation (e.g., Imagen), the server automatically:

1. Detects base64 image outputs in Gemini responses
2. Uploads images to the configured bucket server
3. Returns OpenAI-style mixed content with `image_url` parts

Example response for image generation:

```json
{
  "id": "msg_...",
  "object": "chat.completion",
  "model": "gemini-1.5-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "Here's the image you requested:"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "http://localhost:3003/uploads/generated-image-1234567890.jpg"
            }
          }
        ]
      },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15 }
}
```

**Requirements for Image Generation:**
- A bucket server running on the configured endpoint (default: `http://localhost:3003`)
- The bucket server should serve an index.html file at the root URL for health checks
- The bucket server must accept POST requests to `/upload` endpoint
- The bucket server should return JSON with `{success: true, url: "uploaded_file_url"}`
- Optional: Set `BUCKET_API_KEY` for authenticated uploads
- Fallback: If bucket server is unavailable, images will be returned as data URLs

## Image Generation Summary

This implementation successfully adds **complete image generation support** to the Gemini reverse proxy:

### ✅ **Completed Features**

1. **Mixed Content Detection**: Automatically detects when Gemini returns base64 images alongside text
2. **Image Upload Integration**: Uploads generated images to configured bucket server with API key support
3. **Fallback Handling**: Falls back to data URLs when bucket server is unavailable
4. **OpenAI Compatibility**: Returns proper OpenAI-style mixed content responses with `image_url` parts
5. **Environment Configuration**: Supports both legacy and new bucket configuration options
6. **Health Monitoring**: Checks bucket server availability at startup
7. **Error Handling**: Graceful degradation with detailed logging

### 🔧 **Configuration**

Two configuration approaches supported:

**Option 1: Direct Bucket Configuration (Recommended)**
```env
BUCKET_API_URL=http://localhost:3003/upload
BUCKET_API_KEY=your_bucket_api_key_here
```

**Option 2: Legacy URL Transformation**
```env
TRANSFORM_SOURCE_HOSTNAME=bucket.example.com
TRANSFORM_TARGET_HOSTNAME=localhost
TRANSFORM_TARGET_PORT=3003
TRANSFORM_TARGET_PROTOCOL=http:
```

### 🎯 **Response Format**

When Gemini generates images, responses automatically transform from Gemini's format:
```json
{
  "candidates": [{
    "content": {
      "parts": [
        {"text": "Here's your image:"},
        {"inlineData": {"mimeType": "image/png", "data": "base64..."}}
      ]
    }
  }]
}
```

To OpenAI's mixed content format:
```json
{
  "choices": [{
    "message": {
      "content": [
        {"type": "text", "text": "Here's your image:"},
        {"type": "image_url", "image_url": {"url": "http://localhost:3003/uploads/image.png"}}
      ]
    }
  }]
}
```

### 🧪 **Testing**

Use the included test scripts:
```bash
npm run test:comprehensive  # Full functionality test
npm run test:image-gen     # Image generation specific test
```

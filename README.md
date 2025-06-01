# gemini-reverse

A reverse proxy server that translates OpenAI chat completion API requests to Google Gemini API calls, supporting file attachments (images, documents, audio, YouTube videos), tools, reasoning effort, and proper error handling.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Support for text, image_url, and file_url message content parts
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
   # URL transformation settings for local development (if your local file server is referenced by an external domain name)
   TRANSFORM_SOURCE_HOSTNAME=your-domain.com
   TRANSFORM_TARGET_HOSTNAME=localhost
   TRANSFORM_TARGET_PORT=3003
   TRANSFORM_TARGET_PROTOCOL=http:
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

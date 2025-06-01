import https from 'https';
import mime from 'mime';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Helper function to transform URLs for local development
export function transformUrlForLocal(url: string): string {
  try {
    const parsedUrl = new URL(url);
    
    // Get transformation settings from environment variables
    const sourceHostname = process.env.TRANSFORM_SOURCE_HOSTNAME;
    const targetHostname = process.env.TRANSFORM_TARGET_HOSTNAME || 'localhost';
    const targetPort = process.env.TRANSFORM_TARGET_PORT;
    const targetProtocol = process.env.TRANSFORM_TARGET_PROTOCOL || 'http:';
    
    // Only transform if source hostname is configured and matches
    if (sourceHostname && parsedUrl.hostname === sourceHostname) {
      // Convert to target hostname and protocol
      parsedUrl.hostname = targetHostname;
      if (targetPort) {
        parsedUrl.port = targetPort;
      }
      parsedUrl.protocol = targetProtocol;
      console.log(`Transformed URL: ${url} -> ${parsedUrl.toString()}`);
      return parsedUrl.toString();
    }
    
    // Return original URL if no transformation needed
    return url;
  } catch (error) {
    console.warn(`Failed to parse URL for transformation: ${url}`, error);
    return url; // Return original URL if parsing fails
  }
}

// Helper function to fetch file and convert to base64
export async function fetchFileAsBase64(fileUrl: string): Promise<{ base64Data: string; mimeType: string }> {
  const transformedUrl = transformUrlForLocal(fileUrl);
  const response = await fetch(transformedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText} from URL: ${fileUrl}`);
  }
  const fileBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(fileBuffer).toString('base64');
  let detectedMimeType = response.headers.get('content-type');
  if (!detectedMimeType) {
    // Try mime package
    const typeFromUrl = mime.getType(fileUrl);
    if (typeFromUrl) {
      detectedMimeType = typeFromUrl;
    } else {
      // Fallback to magic number detection
      detectedMimeType = getMimeTypeFromBase64(base64Data);
    }
  }
  return { base64Data, mimeType: detectedMimeType || 'application/octet-stream' };
}

// Helper function to fetch image and convert to base64
export async function fetchImageAsBase64(imageUrl: string): Promise<{ base64Data: string; mimeType: string }> {
  try {
    const transformedUrl = transformUrlForLocal(imageUrl);
    const response = await fetch(transformedUrl);
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
    return { base64Data, mimeType: detectedMimeType || 'image/jpeg' };
  } catch (error) {
    console.error(`Error fetching image ${imageUrl}:`, error);
    throw error; // Re-throw to be handled by the main error handler
  }
}

// Helper function to get MIME type from base64 data
export function getMimeTypeFromBase64(base64Data: string): string {
  const binaryData = Buffer.from(base64Data, 'base64');
  const hex = binaryData.toString('hex', 0, 20).toLowerCase();
  // Images
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('424d')) return 'image/bmp';
  if (hex.startsWith('52494646') && hex.includes('57454250')) return 'image/webp';
  // Video
  if (hex.startsWith('000001b3') || hex.startsWith('000001ba')) return 'video/mpeg';
  if (hex.startsWith('52494646') && hex.includes('41564920')) return 'video/x-msvideo';
  if (hex.startsWith('66747970')) {
    if (hex.includes('6d703432')) return 'video/mp4';
    if (hex.includes('4d534e56')) return 'video/mp4';
    if (hex.includes('69736f6d')) return 'video/mp4';
  }
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  if (hex.startsWith('464c56')) return 'video/x-flv';
  if (hex.startsWith('2e524d46')) return 'video/x-rmvb';
  // Documents
  if (hex.startsWith('25504446')) return 'application/pdf'; // PDF
  if (hex.startsWith('504b0304')) {
    // Could be docx, xlsx, pptx, or zip
    // Check for [Content_Types].xml in the file (for docx/xlsx/pptx)
    const xmlString = binaryData.toString('utf8', 0, 200).toLowerCase();
    if (xmlString.includes('[content_types].xml')) {
      if (xmlString.includes('word/')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; // docx
      if (xmlString.includes('ppt/')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; // pptx
      if (xmlString.includes('xl/')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; // xlsx
    }
    return 'application/zip';
  }
  if (hex.startsWith('d0cf11e0')) {
    // Could be old MS Office (doc, xls, ppt)
    // Try to distinguish by looking for magic strings
    const ascii = binaryData.toString('ascii', 0, 512);
    if (ascii.includes('WordDocument')) return 'application/msword';
    if (ascii.includes('Workbook')) return 'application/vnd.ms-excel';
    if (ascii.includes('PowerPoint')) return 'application/vnd.ms-powerpoint';
    return 'application/x-ms-office';
  }
  // Default fallback
  return 'application/octet-stream';
}

// Helper function to resolve a single redirect URL
export async function resolveRedirect(url: string): Promise<string> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // console.warn(`Skipping redirect resolution for non-HTTP/S URL: ${url}`);
    return url;
  }
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    return response.url || url; // response.url should be the final URL after all redirects
  } catch (error) {
    console.error(`Error resolving redirect for ${url}:`, error);
    return url; // Return original URL in case of an error
  }
}

// Function to resolve redirects with fallback for 403/405 errors
export async function resolveRedirects(url: string, visitedUrls: Set<string> = new Set(), method: string = 'HEAD'): Promise<string> {
  if (visitedUrls.has(url)) {
    console.error(`Circular redirect detected for URL: ${url}`);
    return url; // Avoid infinite loops
  }
  visitedUrls.add(url);

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      method: method,
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' // More common User-Agent
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Resolve relative redirects
        const redirectUrl = new URL(res.headers.location, url).toString();
        // Limit recursion depth if necessary, or rely on visitedUrls for cycles
        if (visitedUrls.size > 10) { // Max 10 redirects
            console.error(`Max redirects exceeded for URL: ${url}`);
            resolve(url); // Return the last known URL before exceeding max redirects
            return;
        }
        resolve(resolveRedirects(redirectUrl, visitedUrls, method));
      } else if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve(url); // Final URL
      } else if ((res.statusCode === 405 || res.statusCode === 403) && method === 'HEAD') {
        // Try with GET method if HEAD failed with 405 (Method Not Allowed) or 403 (Forbidden)
        console.warn(`${method} method failed with ${res.statusCode} for ${url}, trying GET method`);
        // Remove from visitedUrls to allow retry with different method
        visitedUrls.delete(url);
        resolve(resolveRedirects(url, visitedUrls, 'GET'));
      } else if (res.statusCode === 403 || res.statusCode === 405) {
        // If GET also fails with 403/405, just return the original URL
        console.warn(`Access denied or method not allowed for URL: ${url}, Status: ${res.statusCode}. Returning original URL.`);
        resolve(url);
      } else {
        console.error(`Failed to resolve URL: ${url}, Status: ${res.statusCode}`);
        resolve(url); // Return original URL on error or other non-redirect/success status
      }
    });

    req.on('error', (e) => {
      console.error(`Error resolving URL ${url}: ${e.message}`);
      resolve(url); // Return original URL on request error
    });

    // Set a timeout to avoid hanging requests
    req.setTimeout(5000, () => {
      console.warn(`Timeout resolving URL: ${url}. Returning original URL.`);
      req.destroy();
      resolve(url);
    });

    req.end();
  });
}

// Helper function to process grounding chunks and add resolved URIs
export async function getResolvedGroundingChunks(groundingChunks: any[] | undefined): Promise<any[] | undefined> {
  if (!groundingChunks) {
    return undefined;
  }
  return Promise.all(
    groundingChunks.map(async (chunk) => {
      if (chunk.web && chunk.web.uri) {
        const resolvedUri = await resolveRedirect(chunk.web.uri);
        return {
          ...chunk,
          web: {
            ...chunk.web,
            resolved_uri: resolvedUri, // Adds a new field with the resolved URI
          },
        };
      }
      return chunk;
    })
  );
}

// Helper function to fetch audio and convert to base64
export async function fetchAudioAsBase64(audioUrl: string): Promise<{ base64Data: string; mimeType: string }> {
  try {
    const transformedUrl = transformUrlForLocal(audioUrl);
    const response = await fetch(transformedUrl);
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
    return { base64Data, mimeType: detectedMimeType || 'application/octet-stream' };
  } catch (error) {
    console.error(`Error fetching audio ${audioUrl}:`, error);
    throw error; // Re-throw to be handled by the main error handler
  }
}

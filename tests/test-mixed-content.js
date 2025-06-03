#!/usr/bin/env node

/**
 * Mock test for image generation functionality
 * This script simulates a Gemini response with base64 image data
 * to test the mixed content processing without requiring actual Gemini calls
 */

const { processGeminiResponseParts, isGeminiImagePart } = require('../src/utils');

// Mock Gemini response parts with text and image
const mockGeminiParts = [
  {
    text: "Here's the image you requested:"
  },
  {
    inlineData: {
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    }
  },
  {
    text: "This is a simple 1x1 transparent PNG image for testing."
  }
];

async function testMixedContentProcessing() {
  console.log('Testing mixed content processing...');
  
  try {
    // Test individual part detection
    console.log('\n=== Part Detection Tests ===');
    mockGeminiParts.forEach((part, index) => {
      console.log(`Part ${index + 1}:`);
      console.log(`  Has text: ${!!part.text}`);
      console.log(`  Is image: ${isGeminiImagePart(part)}`);
      if (part.text) {
        console.log(`  Text: "${part.text}"`);
      }
      if (isGeminiImagePart(part)) {
        console.log(`  MIME type: ${part.inlineData.mimeType}`);
        console.log(`  Data length: ${part.inlineData.data.length} chars`);
      }
    });
    
    // Test full processing
    console.log('\n=== Processing Mixed Content ===');
    const processedParts = await processGeminiResponseParts(mockGeminiParts);
    
    console.log(`Processed ${processedParts.length} parts:`);
    processedParts.forEach((part, index) => {
      console.log(`\nPart ${index + 1}:`);
      console.log(`  Type: ${part.type}`);
      if (part.type === 'text') {
        console.log(`  Text: "${part.text}"`);
      } else if (part.type === 'image_url') {
        console.log(`  Image URL: ${part.image_url.url.substring(0, 100)}...`);
        console.log(`  Is data URL: ${part.image_url.url.startsWith('data:')}`);
      }
    });
    
    // Generate OpenAI-style response format
    console.log('\n=== OpenAI Response Format ===');
    const openAIResponse = {
      id: "msg_test_" + Date.now(),
      object: "chat.completion", 
      model: "gemini-1.5-flash",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: processedParts
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };
    
    console.log(JSON.stringify(openAIResponse, null, 2));
    
  } catch (error) {
    console.error('Error during testing:', error.message);
  }
}

// Run the test
testMixedContentProcessing();

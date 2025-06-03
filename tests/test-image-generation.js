#!/usr/bin/env node

/**
 * Test script for image generation functionality
 * This script demonstrates how the server handles mixed content responses
 * when Gemini returns base64 images.
 */

const fetch = require('node-fetch');

async function testImageGeneration() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('Please set GEMINI_API_KEY environment variable');
    process.exit(1);
  }

  console.log('Testing image generation functionality...');
  
  const request = {
    model: 'gemini-1.5-flash',
    messages: [
      {
        role: 'user',
        content: 'Generate a simple image of a cat'
      }
    ],
    temperature: 0.7
  };

  try {
    const response = await fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(request)
    });

    const result = await response.json();
    
    console.log('\n=== Response ===');
    console.log('Status:', response.status);
    console.log('Content Type:', typeof result.choices[0].message.content);
    
    if (Array.isArray(result.choices[0].message.content)) {
      console.log('Mixed content detected!');
      console.log('Content parts:', result.choices[0].message.content.length);
      
      result.choices[0].message.content.forEach((part, index) => {
        console.log(`Part ${index + 1}:`, part.type);
        if (part.type === 'image_url') {
          console.log('  Image URL:', part.image_url.url);
        } else if (part.type === 'text') {
          console.log('  Text:', part.text.substring(0, 100) + '...');
        }
      });
    } else {
      console.log('Text-only response:', result.choices[0].message.content.substring(0, 200) + '...');
    }
    
    console.log('\nUsage:', result.usage);

  } catch (error) {
    console.error('Error testing image generation:', error.message);
  }
}

// Run the test
testImageGeneration();

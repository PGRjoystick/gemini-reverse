#!/usr/bin/env node

/**
 * Comprehensive test for the Gemini reverse proxy image generation features
 * This script tests a real request to verify the server handles mixed content properly
 */

const fetch = require('node-fetch');

async function testImageGenerationEndpoint() {
  console.log('🚀 Testing Gemini Reverse Proxy Image Generation Features');
  console.log('=' .repeat(60));
  
  // Test 1: Basic text request (should work normally)
  console.log('\n📝 Test 1: Basic text request');
  try {
    const response = await fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GEMINI_API_KEY || 'test-key'}`
      },
      body: JSON.stringify({
        model: 'gemini-1.5-flash',
        messages: [
          {
            role: 'user',
            content: 'Say hello!'
          }
        ]
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✓ Text request successful');
      console.log(`  Response type: ${typeof result.choices[0].message.content}`);
      console.log(`  Content preview: ${typeof result.choices[0].message.content === 'string' 
        ? result.choices[0].message.content.substring(0, 50) + '...'
        : '[Array content]'}`);
    } else {
      console.log(`✗ Text request failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.log(`✗ Text request error: ${error.message}`);
  }

  // Test 2: Image generation request (will likely be text-only unless using an image model)
  console.log('\n🎨 Test 2: Image generation request');
  try {
    const response = await fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GEMINI_API_KEY || 'test-key'}`
      },
      body: JSON.stringify({
        model: 'gemini-1.5-flash',
        messages: [
          {
            role: 'user',
            content: 'Create a simple drawing or diagram showing the concept of artificial intelligence'
          }
        ],
        temperature: 0.7
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✓ Image generation request successful');
      console.log(`  Response type: ${typeof result.choices[0].message.content}`);
      console.log(`  Model used: ${result.model}`);
      
      if (Array.isArray(result.choices[0].message.content)) {
        console.log('🎉 Mixed content detected!');
        console.log(`  Content parts: ${result.choices[0].message.content.length}`);
        
        result.choices[0].message.content.forEach((part, index) => {
          console.log(`    Part ${index + 1}: ${part.type}`);
          if (part.type === 'image_url') {
            console.log(`      URL: ${part.image_url.url.substring(0, 60)}...`);
            console.log(`      Type: ${part.image_url.url.startsWith('data:') ? 'Data URL' : 'Uploaded URL'}`);
          } else if (part.type === 'text') {
            console.log(`      Text: ${part.text.substring(0, 60)}...`);
          }
        });
      } else {
        console.log('📄 Text-only response (no images generated)');
        console.log(`  Content: ${result.choices[0].message.content.substring(0, 100)}...`);
      }
      
      console.log(`  Usage: ${JSON.stringify(result.usage)}`);
    } else {
      const errorText = await response.text();
      console.log(`✗ Image generation request failed: ${response.status} ${response.statusText}`);
      console.log(`  Error: ${errorText}`);
    }
  } catch (error) {
    console.log(`✗ Image generation request error: ${error.message}`);
  }

  // Test 3: Bucket server health check
  console.log('\n🏥 Test 3: Bucket server health');
  try {
    const response = await fetch('http://localhost:3003', {
      method: 'GET'
    });
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      console.log(`✓ Bucket server is running: ${response.status} ${response.statusText}`);
      console.log(`  Content-Type: ${contentType}`);
      console.log('  Server serves index.html as expected for health checks');
    } else {
      console.log(`✗ Bucket server not responding properly: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.log(`✗ Bucket server health check failed: ${error.message}`);
  }

  console.log('\n' + '=' .repeat(60));
  console.log('🏁 Test completed!');
  console.log('\nNotes:');
  console.log('- Mixed content responses require Gemini models that support image generation');
  console.log('- Without a bucket server, images will be returned as data URLs');
  console.log('- The server automatically falls back gracefully when bucket server is unavailable');
}

// Run the test
testImageGenerationEndpoint().catch(console.error);

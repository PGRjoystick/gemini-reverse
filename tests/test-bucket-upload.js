/**
 * Test script to debug bucket server upload response
 */

const FormData = require('form-data');
const axios = require('axios');
const fs = require('fs');

async function testBucketUpload() {
  console.log('🧪 Testing bucket server upload...\n');

  try {
    // Create a simple test image (1x1 red pixel PNG)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const testImageBuffer = Buffer.from(testImageBase64, 'base64');
    
    // Create form data
    const formData = new FormData();
    formData.append('file', testImageBuffer, {
      filename: `test-image-${Date.now()}.png`,
      contentType: 'image/png',
    });
    
    // Prepare headers
    const headers = formData.getHeaders();
    if (process.env.BUCKET_API_KEY) {
      headers['x-api-key'] = process.env.BUCKET_API_KEY;
    }
    
    console.log('Upload URL:', process.env.BUCKET_API_URL || 'http://localhost:3003/upload');
    console.log('Headers:', headers);
    
    // Upload to bucket server
    const response = await axios.post(
      process.env.BUCKET_API_URL || 'http://localhost:3003/upload',
      formData,
      { headers }
    );
    
    console.log('\n📋 Upload Response Details:');
    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    console.log('Data Type:', typeof response.data);
    console.log('Data:', JSON.stringify(response.data, null, 2));
    console.log('Response Headers:', response.headers);
    
    // Test different response parsing scenarios
    const result = response.data;
    
    if (result && result.success === true) {
      console.log('\n✅ Success field found:', result.url);
    } else if (result && result.url) {
      console.log('\n⚠️ URL found but no success field:', result.url);
    } else if (typeof result === 'string' && result.startsWith('http')) {
      console.log('\n⚠️ URL returned as string:', result);
    } else {
      console.log('\n❌ Unexpected response format');
    }
    
  } catch (error) {
    console.error('\n❌ Upload failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Load environment variables
require('dotenv').config();

// Run the test
if (require.main === module) {
  testBucketUpload().catch(console.error);
}

module.exports = { testBucketUpload };

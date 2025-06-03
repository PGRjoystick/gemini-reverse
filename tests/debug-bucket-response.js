const axios = require('axios');
const FormData = require('form-data');

async function debugBucketUpload() {
  try {
    console.log('Testing bucket server upload...');
    
    // Create a simple test image (1x1 pixel PNG)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const testImageBuffer = Buffer.from(testImageBase64, 'base64');
    
    // Create form data
    const formData = new FormData();
    formData.append('file', testImageBuffer, {
      filename: 'test-image.png',
      contentType: 'image/png',
    });
    
    // Upload to bucket server
    const bucketUrl = 'http://localhost:3003/upload';
    
    console.log(`Uploading to: ${bucketUrl}`);
    
    const headers = formData.getHeaders();
    headers['x-api-key'] = 'EgpQoNu2thdmG3WCVbRhDiY6gmy9sASVQ4LZe';
    console.log('Request headers:', headers);
    
    const response = await axios.post(bucketUrl, formData, {
      headers: headers,
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    console.log('Response data:', response.data);
    console.log('Response data type:', typeof response.data);
    
    // Check various properties that might exist
    if (response.data) {
      console.log('Data properties:', Object.keys(response.data));
      console.log('Has success property:', 'success' in response.data);
      console.log('Has url property:', 'url' in response.data);
      console.log('Has data property:', 'data' in response.data);
      console.log('Has file property:', 'file' in response.data);
      console.log('Has path property:', 'path' in response.data);
    }
    
  } catch (error) {
    console.error('Error details:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Status text:', error.response.statusText);
      console.error('Response data:', error.response.data);
      console.error('Response headers:', error.response.headers);
    } else {
      console.error('Error message:', error.message);
      console.error('Full error:', error);
    }
  }
}

debugBucketUpload();

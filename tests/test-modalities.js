/**
 * Test script for modalities parameter support
 * Tests the modalities parameter mapping to responseModalities in Gemini API
 */

const API_BASE_URL = 'http://localhost:3000';

async function testModalities() {
  console.log('🧪 Testing modalities parameter support...\n');

  const tests = [
    {
      name: 'Text only modality',
      modalities: ['text'],
      expectedResponseModalities: ['TEXT']
    },
    {
      name: 'Image only modality',
      modalities: ['image'],
      expectedResponseModalities: ['IMAGE']
    },
    {
      name: 'Mixed content modalities',
      modalities: ['text', 'image'],
      expectedResponseModalities: ['TEXT', 'IMAGE']
    },
    {
      name: 'Case insensitive modalities',
      modalities: ['TEXT', 'Image'],
      expectedResponseModalities: ['TEXT', 'IMAGE']
    },
    {
      name: 'Invalid modality filtering',
      modalities: ['text', 'video', 'image', 'audio'],
      expectedResponseModalities: ['TEXT', 'IMAGE']
    },
    {
      name: 'No modalities parameter',
      modalities: undefined,
      expectedResponseModalities: undefined
    }
  ];

  for (const test of tests) {
    console.log(`🔍 Testing: ${test.name}`);
    
    const requestBody = {
      model: 'gemini-1.5-flash',
      messages: [
        {
          role: 'user',
          content: 'Hello, this is a test message.'
        }
      ]
    };

    if (test.modalities !== undefined) {
      requestBody.modalities = test.modalities;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key-for-modalities-testing'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log(`✅ Request successful`);
        console.log(`   Input modalities: ${test.modalities ? JSON.stringify(test.modalities) : 'undefined'}`);
        console.log(`   Expected responseModalities: ${test.expectedResponseModalities ? JSON.stringify(test.expectedResponseModalities) : 'undefined'}`);
        
        // Note: We can't directly see the responseModalities sent to Gemini,
        // but we can verify the request was processed without errors
        if (result.choices && result.choices[0] && result.choices[0].message) {
          console.log(`   Response received with ${typeof result.choices[0].message.content} content`);
        }
      } else {
        console.log(`❌ Request failed: ${result.error || 'Unknown error'}`);
        if (result.details) {
          console.log(`   Details: ${result.details}`);
        }
      }
    } catch (error) {
      console.log(`❌ Request error: ${error.message}`);
    }
    
    console.log(''); // Empty line for readability
  }
}

// Run the test
if (require.main === module) {
  testModalities().catch(console.error);
}

module.exports = { testModalities };

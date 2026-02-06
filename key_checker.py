import os
import requests
import time

# Configuration
ENV_FILE_PATH = '.env'
WORKING_OUTPUT_FILE = 'working_keys.txt'
DEAD_OUTPUT_FILE = 'dead_keys.txt'
DELAY_SECONDS = 30    # Standard delay between different keys
RETRY_DELAY = 10       # Delay for 500/503 retries

URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"

PAYLOAD = {
    "contents": [
        {
            "role": "user",
            "parts": [{"text": "Say hello world in French."}]
        }
    ]
}

def get_keys_from_env(filepath):
    if not os.path.exists(filepath):
        print(f"Error: {filepath} not found.")
        return []
    with open(filepath, 'r') as f:
        for line in f:
            if line.strip().startswith("KEYS="):
                raw_keys = line.strip().replace("KEYS=", "").split(',')
                return [k.strip() for k in raw_keys if k.strip()]
    return []

def check_key(api_key, is_retry=False):
    """Sends request and handles 500/503 retries."""
    headers = {
        'x-goog-api-key': api_key,
        'Content-Type': 'application/json'
    }

    try:
        response = requests.post(URL, headers=headers, json=PAYLOAD, timeout=15)
        
        # Success
        if response.status_code == 200:
            return True, response.status_code
        
        # Retry Logic for 500 or 503
        if response.status_code in [500, 503] and not is_retry:
            print(f"  ⚠️ Server Error {response.status_code}. Retrying in {RETRY_DELAY}s...")
            time.sleep(RETRY_DELAY)
            return check_key(api_key, is_retry=True) # Recursive call for 1 retry
            
        return False, response.status_code
    except requests.exceptions.RequestException as e:
        return False, str(e)

def main():
    keys = get_keys_from_env(ENV_FILE_PATH)
    if not keys:
        print("No keys found.")
        return

    print(f"Found {len(keys)} keys. Starting validation...\n")

    working_keys = []
    dead_keys = []

    for index, api_key in enumerate(keys):
        print(f"[{index + 1}/{len(keys)}] Checking: {api_key[:10]}...")
        is_working, status = check_key(api_key)

        if is_working:
            print(f"  ✅ Working (Status: {status})")
            working_keys.append(api_key)
        else:
            print(f"  ❌ Dead (Status: {status})")
            dead_keys.append(api_key)

        # Normal delay between different keys (except after the last key)
        if index < len(keys) - 1:
            print(f"  ⏳ Waiting {DELAY_SECONDS}s for next key...", flush=True)
            time.sleep(DELAY_SECONDS)

    # Save results in comma-separated format: key1,key2,key3
    with open(WORKING_OUTPUT_FILE, 'w') as f:
        f.write(",".join(working_keys))
    
    with open(DEAD_OUTPUT_FILE, 'w') as f:
        f.write(",".join(dead_keys))

    print("\n" + "="*20)
    print(f"DONE!")
    print(f"Working: {len(working_keys)} (Saved to {WORKING_OUTPUT_FILE})")
    print(f"Dead:    {len(dead_keys)} (Saved to {DEAD_OUTPUT_FILE})")

if __name__ == "__main__":
    main()
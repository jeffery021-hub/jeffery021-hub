
const SYSTEM_INSTRUCTION = `
You are a professional simultaneous interpreter.
The user will provide text in either Chinese or English.
1. Detect the language automatically.
2. If it's Chinese, translate to English.
3. If it's English, translate to Chinese.
4. Output ONLY the translated text. Do not add explanations, notes, or preamble.
`;

// Helper to safely retrieve API Key from various environment configurations
const getApiKey = (): string => {
  let key = "";
  // 1. Check runtime environment variables
  if (typeof process !== 'undefined' && process.env) {
    key = process.env.GROQ_API_KEY || process.env.API_KEY || 
          process.env.VITE_GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY || "";
  }
  // 2. Check Vite env
  if (!key) {
    try {
      // @ts-ignore
      if (import.meta?.env?.VITE_GROQ_API_KEY) key = import.meta.env.VITE_GROQ_API_KEY;
      // @ts-ignore
      else if (import.meta?.env?.GROQ_API_KEY) key = import.meta.env.GROQ_API_KEY;
    } catch (e) {}
  }
  // 3. Check global window (user input fallback)
  if (!key && typeof window !== 'undefined') {
    // @ts-ignore
    key = window.GROQ_API_KEY || window.localStorage.getItem('groq_api_key') || "";
  }
  
  return key.trim();
};

// Helper to get Base URL (defaulting to official Groq API)
const getBaseUrl = (): string => {
  let url = "";
  if (typeof window !== 'undefined') {
    url = window.localStorage.getItem('groq_base_url') || "";
  }
  if (!url && typeof process !== 'undefined' && process.env) {
    url = process.env.GROQ_BASE_URL || "";
  }
  
  // Clean up URL: remove trailing slash
  url = url.trim();
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  
  // Default to official API if not set
  return url || "https://api.groq.com/openai/v1";
};

// Helper: Convert Base64 back to Blob for FormData
const base64ToBlob = async (base64: string, mimeType: string): Promise<Blob> => {
  const res = await fetch(`data:${mimeType};base64,${base64}`);
  return await res.blob();
};

export const translateAudio = async (base64Audio: string, mimeType: string = 'audio/webm'): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("MISSING_API_KEY_LOCAL"); // Custom error code to trigger UI prompt
  }

  const baseUrl = getBaseUrl();

  try {
    // --- Step 1: Transcription via Groq Whisper ---
    const audioBlob = await base64ToBlob(base64Audio, mimeType);
    const formData = new FormData();
    // Groq Whisper expects a file with a filename
    const extension = mimeType.split('/')[1]?.split(';')[0] || 'webm';
    formData.append('file', audioBlob, `audio.${extension}`);
    formData.append('model', 'whisper-large-v3'); 
    formData.append('response_format', 'json');

    const transcriptResponse = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!transcriptResponse.ok) {
      const err = await transcriptResponse.json().catch(() => ({}));
      const errMsg = err.error?.message || transcriptResponse.statusText;
      // Pass through 401 specifically for UI handling
      if (transcriptResponse.status === 401) {
         throw new Error(`API_KEY_INVALID: ${errMsg}`);
      }
      throw new Error(`Groq Transcription Error: ${errMsg}`);
    }

    const transcriptData = await transcriptResponse.json();
    const transcribedText = transcriptData.text?.trim();

    if (!transcribedText) {
      throw new Error("未能识别出语音 (No speech detected)");
    }

    // --- Step 2: Translation via Groq Llama/Mixtral ---
    const completionResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Fast and accurate for translation
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: transcribedText }
        ],
        temperature: 0.3,
      }),
    });

    if (!completionResponse.ok) {
      const err = await completionResponse.json().catch(() => ({}));
      const errMsg = err.error?.message || completionResponse.statusText;
       if (completionResponse.status === 401) {
         throw new Error(`API_KEY_INVALID: ${errMsg}`);
      }
      throw new Error(`Groq Translation Error: ${errMsg}`);
    }

    const completionData = await completionResponse.json();
    const translatedText = completionData.choices?.[0]?.message?.content?.trim();

    if (!translatedText) {
      throw new Error("翻译结果为空");
    }

    return translatedText;

  } catch (error) {
    console.error("Groq Service Error:", error);
    throw error;
  }
};

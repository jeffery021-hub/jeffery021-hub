import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `
You are a professional simultaneous interpreter.
Listen to the audio input carefully.
Detect the language automatically.
If it's Chinese, translate to English. If it's English, translate to Chinese.
Output ONLY the translated text. Do not add explanations, notes, or preamble.
`;

export const translateAudio = async (base64Audio: string, mimeType: string = 'audio/webm'): Promise<string> => {
  try {
    // Initialize the client inside the function to ensure we use the most up-to-date
    // process.env.API_KEY, which might have just been selected by the user.
    const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // We use gemini-2.0-flash-exp which supports audio input via generateContent.
    const modelId = 'gemini-2.0-flash-exp';
    
    const response = await genAI.models.generateContent({
      model: modelId,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.4, // Lower temperature for more accurate translation
      },
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          }
        ]
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No translation generated.");
    }
    
    return text.trim();
  } catch (error) {
    console.error("Gemini Translation Error:", error);
    throw error;
  }
};
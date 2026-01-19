export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove the Data-URL declaration (e.g., "data:audio/webm;base64,")
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const detectLanguageFromText = (text: string): 'zh' | 'en' => {
  // Simple heuristic: if it contains Chinese characters, assume Chinese output
  // This is used for TTS selection
  const chineseRegex = /[\u4e00-\u9fa5]/;
  return chineseRegex.test(text) ? 'zh' : 'en';
};

export const speakText = (text: string, lang: 'zh' | 'en') => {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  
  // Set voice based on detected language
  // We try to find a Google voice or a native voice for the specific language
  const voices = window.speechSynthesis.getVoices();
  
  let selectedVoice = null;
  
  if (lang === 'zh') {
    selectedVoice = voices.find(v => v.lang.includes('zh-CN') || v.lang.includes('zh'));
    utterance.lang = 'zh-CN';
  } else {
    selectedVoice = voices.find(v => v.lang.includes('en-US') || v.lang.includes('en'));
    utterance.lang = 'en-US';
  }

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  // Optimize rate/pitch for natural sounding translation
  utterance.rate = 1.0; 
  utterance.pitch = 1.0;

  window.speechSynthesis.speak(utterance);
};
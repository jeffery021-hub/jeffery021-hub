export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export interface TranslationResult {
  originalText?: string; 
  translatedText: string;
  detectedLanguage?: 'zh' | 'en';
}

export interface AudioConfig {
  sampleRate: number;
  mimeType: string;
}

declare global {
  interface Window {
    GOOGLE_API_KEY?: string;
    VITE_API_KEY?: string;
    API_KEY?: string;
  }
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}
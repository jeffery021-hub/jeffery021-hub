export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export interface TranslationResult {
  originalText?: string; // We might not get this from audio-only, but good to have in type
  translatedText: string;
  detectedLanguage?: 'zh' | 'en';
}

export interface AudioConfig {
  sampleRate: number;
  mimeType: string;
}

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}
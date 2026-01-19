import React, { useState, useRef, useEffect, useCallback } from 'react';
import { translateAudio } from './services/geminiService';
import { blobToBase64, speakText, detectLanguageFromText } from './utils/audioUtils';
import { AppState } from './types';
import { ActionButton } from './components/ActionButton';
import { Waveform } from './components/Waveform';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [translation, setTranslation] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true); // Assume true initially to prevent flash
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');

  // Check for API Key on mount
  useEffect(() => {
    const checkApiKey = async () => {
      try {
        if (window.aistudio && window.aistudio.hasSelectedApiKey) {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        }
      } catch (e) {
        console.warn("Failed to check API key status", e);
      }
    };
    checkApiKey();
  }, []);

  // Initialize Speech Synthesis on mount to load voices
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const handleSelectKey = async () => {
    try {
      if (window.aistudio) {
        await window.aistudio.openSelectKey();
        // Assume success and proceed immediately to avoid race conditions
        setHasApiKey(true);
        setErrorMsg(null);
      }
    } catch (e) {
      console.error("Failed to select key", e);
      setErrorMsg("Failed to open key selection dialog.");
    }
  };

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // Let browser use default
  };

  const startRecording = async () => {
    try {
      setAppState(AppState.RECORDING);
      setErrorMsg(null);
      setTranslation(null);
      window.speechSynthesis.cancel(); // Stop any current speech

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType || 'audio/webm'; // Fallback for Blob creation if empty
      
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();

    } catch (err) {
      console.error("Error accessing microphone:", err);
      setErrorMsg("Could not access microphone. Please allow permissions.");
      setAppState(AppState.ERROR);
    }
  };

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      
      // Wait for the stop event to fire and chunks to be gathered
      mediaRecorderRef.current.onstop = async () => {
        // Stop all tracks to release mic
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
        
        handleTranslationProcess();
      };
    }
  }, []);

  const handleTranslationProcess = async () => {
    setAppState(AppState.PROCESSING);

    try {
      // Use the resolved MIME type or default to webm if unknown
      const mimeType = mimeTypeRef.current;
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      
      if (audioBlob.size < 100) {
        throw new Error("Audio too short");
      }

      const base64Audio = await blobToBase64(audioBlob);
      
      // Call Gemini API with correct MIME type
      const resultText = await translateAudio(base64Audio, mimeType);
      
      setTranslation(resultText);
      setAppState(AppState.SPEAKING);

      // Determine language for TTS (Result is the target language)
      const detectedLang = detectLanguageFromText(resultText);
      
      // Speak the result
      speakText(resultText, detectedLang);
      
      // Reset state after a short delay (or when TTS finishes, but simple delay is safer UX here)
      setTimeout(() => {
        setAppState(AppState.IDLE);
      }, 1000);

    } catch (err: any) {
      console.error("Translation failed:", err);
      
      // Handle standard error message extraction
      let displayError = err.message || "Translation failed. Please try again.";
      try {
        if (displayError.includes('{')) {
            const parsed = JSON.parse(displayError.substring(displayError.indexOf('{')));
            if (parsed.error && parsed.error.message) {
                displayError = parsed.error.message;
            }
        }
      } catch (e) {
          // ignore parsing error
      }

      // Check for specific API Key errors or 404s
      // "Requested entity was not found" or "API key not valid"
      const isKeyError = displayError.includes("API key") || 
                         displayError.includes("not valid") ||
                         displayError.includes("Requested entity was not found");

      if (isKeyError && window.aistudio) {
        setHasApiKey(false); // Force re-selection
        displayError = "Please select a valid API Key to continue.";
      }
      
      setErrorMsg(displayError);
      setAppState(AppState.ERROR);
    }
  };

  if (!hasApiKey) {
    return (
      <div className="flex flex-col h-screen w-full bg-slate-50 items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-blue-100 to-transparent pointer-events-none" />
        
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm w-full text-center z-10 border border-slate-100">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="material-icons-round text-3xl">key</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">API Key Required</h2>
          <p className="text-slate-500 mb-8">
            To use the translator, please select a valid Google Gemini API Key.
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-600/20 transition-all active:scale-95"
          >
            Select API Key
          </button>
          <p className="mt-6 text-xs text-slate-400">
            Learn more about <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-blue-600">billing and keys</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-blue-50 to-transparent pointer-events-none" />

      {/* Header */}
      <header className="flex-none p-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <span className="bg-blue-600 text-white p-2 rounded-lg material-icons-round text-xl">translate</span>
          <h1 className="font-bold text-slate-800 tracking-tight">Gemini Polyglot</h1>
        </div>
        <div className="text-xs font-medium px-3 py-1 bg-white border border-slate-200 rounded-full text-slate-500 shadow-sm flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          Online
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 z-10 gap-8 max-w-lg mx-auto w-full">
        
        {/* Language Indicator */}
        <div className="flex items-center gap-4 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <div className="text-center w-20">
            <div className="text-xs text-slate-400 font-semibold mb-1">INPUT</div>
            <div className="text-lg font-bold text-slate-800">Auto</div>
          </div>
          <span className="material-icons-round text-blue-500">sync_alt</span>
          <div className="text-center w-20">
            <div className="text-xs text-slate-400 font-semibold mb-1">OUTPUT</div>
            <div className="text-lg font-bold text-slate-800">Mix</div>
          </div>
        </div>

        {/* Translation Card */}
        <div className={`
          w-full min-h-[200px] flex items-center justify-center text-center p-8 
          rounded-3xl transition-all duration-500
          ${translation ? 'bg-white shadow-xl shadow-blue-900/5 scale-100 opacity-100' : 'bg-transparent scale-95 opacity-50'}
        `}>
          {errorMsg ? (
            <div className="text-red-500 flex flex-col items-center gap-2 max-w-xs mx-auto">
               <span className="material-icons-round text-3xl">error_outline</span>
               <p className="text-sm break-words">{errorMsg}</p>
               {/* Fallback button if we are in error state but not strictly forced out yet */}
               {errorMsg.includes("Key") && (
                 <button onClick={handleSelectKey} className="mt-2 text-xs bg-red-50 text-red-600 px-3 py-1 rounded-full font-medium">
                   Change Key
                 </button>
               )}
            </div>
          ) : (
             <div className="space-y-4">
               {appState === AppState.RECORDING && (
                 <p className="text-2xl font-medium text-slate-400 animate-pulse">Listening...</p>
               )}
               {appState === AppState.PROCESSING && (
                 <p className="text-2xl font-medium text-blue-500 animate-pulse">Translating...</p>
               )}
               {translation && appState !== AppState.RECORDING && appState !== AppState.PROCESSING && (
                 <>
                  <p className="text-3xl md:text-4xl font-bold text-slate-800 leading-tight">
                    {translation}
                  </p>
                  <div className="flex justify-center pt-4">
                     <button 
                       onClick={() => {
                         if(translation) speakText(translation, detectLanguageFromText(translation));
                       }}
                       className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-colors"
                     >
                       <span className="material-icons-round">volume_up</span>
                     </button>
                  </div>
                 </>
               )}
               {appState === AppState.IDLE && !translation && (
                 <p className="text-slate-400">Press and hold the button below to start translating.</p>
               )}
             </div>
          )}
        </div>

        {/* Visualizer */}
        <Waveform isRecording={appState === AppState.RECORDING} />

      </main>

      {/* Footer / Controls */}
      <footer className="flex-none pb-12 pt-4 px-6 flex justify-center z-20">
        <ActionButton 
          appState={appState} 
          onStart={startRecording} 
          onStop={stopRecording} 
        />
      </footer>
    </div>
  );
};

export default App;
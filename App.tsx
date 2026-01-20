import React, { useState, useRef, useEffect, useCallback } from 'react';
import { translateAudio } from './services/geminiService'; // Keeps same import name to minimize file churn, though logic is now Groq
import { blobToBase64, speakText, detectLanguageFromText } from './utils/audioUtils';
import { AppState } from './types';
import { ActionButton } from './components/ActionButton';
import { Waveform } from './components/Waveform';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [translation, setTranslation] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true); 
  
  // Configuration State
  const [tempKeyInput, setTempKeyInput] = useState("");
  const [tempBaseUrl, setTempBaseUrl] = useState("");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');
  const startTimeRef = useRef<number>(0);
  const isShortRecordingRef = useRef<boolean>(false);
  
  // Refs for enhanced audio processing
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Check for API Key on mount (Local Storage or Env)
  useEffect(() => {
    const checkConfig = () => {
      let keyExists = false;
      // Check Env
      if (process.env.GROQ_API_KEY || process.env.REACT_APP_GROQ_API_KEY) keyExists = true;
      // Check Vite Env
      // @ts-ignore
      else if (import.meta?.env?.VITE_GROQ_API_KEY) keyExists = true;
      // Check LocalStorage
      else {
         const storedKey = window.localStorage.getItem('groq_api_key');
         if (storedKey && storedKey.trim().length > 0) {
           keyExists = true;
           setTempKeyInput(storedKey);
         }
      }

      // Load Base URL
      const storedBaseUrl = window.localStorage.getItem('groq_base_url');
      if (storedBaseUrl) {
        setTempBaseUrl(storedBaseUrl);
      }

      if (!keyExists) {
        setHasApiKey(false);
      }
    };
    checkConfig();
  }, []);

  // Initialize Speech Synthesis on mount to load voices
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const handleSaveConfig = () => {
    const trimmedKey = tempKeyInput.trim();
    if (trimmedKey.startsWith('gsk_')) {
      window.localStorage.setItem('groq_api_key', trimmedKey);
      
      const trimmedUrl = tempBaseUrl.trim();
      if (trimmedUrl) {
        window.localStorage.setItem('groq_base_url', trimmedUrl);
      } else {
        window.localStorage.removeItem('groq_base_url');
      }

      setHasApiKey(true);
      setErrorMsg(null);
      // Reload is not strictly necessary but ensures environment is clean
      window.location.reload(); 
    } else {
      setErrorMsg("无效的 Groq API Key。必须以 'gsk_' 开头。");
    }
  };

  const getSupportedMimeType = () => {
    // Prioritize WebM Opus as it is most compatible with modern APIs
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; 
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("无法访问麦克风。请确保您使用的是 HTTPS 协议或本地环境。");
      }

      setAppState(AppState.RECORDING);
      setErrorMsg(null);
      setTranslation(null);
      window.speechSynthesis.cancel(); 
      
      startTimeRef.current = Date.now();
      isShortRecordingRef.current = false;

      // 1. Get Microphone Stream with optimal native constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1, 
          sampleRate: 44100, // Request standard high quality rate
        } 
      });
      streamRef.current = stream;

      // 2. Setup Web Audio API for Signal Processing (Enhancement)
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Source
      const source = audioContext.createMediaStreamSource(stream);

      // Effect 1: High-pass Filter (Remove low rumble/wind noise < 85Hz)
      const highPassFilter = audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 85; 

      // Effect 2: Dynamics Compressor (Even out volume levels for clearer speech)
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -20; // Lower threshold to catch normal speech
      compressor.knee.value = 40;       // Soft knee
      compressor.ratio.value = 12;      // High compression ratio
      compressor.attack.value = 0;      // Fast attack
      compressor.release.value = 0.25;  // Standard release

      // Effect 3: Gain (Slight boost to ensure good levels)
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.1;

      // Destination
      const destination = audioContext.createMediaStreamDestination();

      // Connect the graph: Source -> HighPass -> Compressor -> Gain -> Destination
      source.connect(highPassFilter);
      highPassFilter.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(destination);
      
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;
      
      // Record from the Processed Destination Stream, not the raw mic
      const mediaRecorder = new MediaRecorder(destination.stream, options);
      
      // CRITICAL: Capture the actual mimeType the browser decided to use.
      mimeTypeRef.current = mediaRecorder.mimeType || mimeType || 'audio/webm';
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100); 

    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      let msg = "无法访问麦克风，请检查权限。";
      if (err.name === 'NotAllowedError') {
        msg = "麦克风权限被拒绝，请在浏览器设置中允许。";
      } else if (err.message) {
        msg = err.message;
      }
      setErrorMsg(msg);
      setAppState(AppState.ERROR);
    }
  };

  const stopRecording = useCallback(async () => {
    // Check if recording is too short (likely an accidental tap)
    const duration = Date.now() - startTimeRef.current;
    if (duration < 1000) { // Threshold increased to 1000ms (1 second)
      isShortRecordingRef.current = true;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      
      mediaRecorderRef.current.onstop = async () => {
        // Cleanup all streams/contexts immediately
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        if (audioContextRef.current) {
          if (audioContextRef.current.state !== 'closed') {
            await audioContextRef.current.close();
          }
          audioContextRef.current = null;
        }

        // Handle Logic based on duration
        if (isShortRecordingRef.current) {
          setAppState(AppState.IDLE);
          setTranslation(null); // Reset translation to null to show default instructions
          setErrorMsg(null); // Clear any previous errors
          return;
        }

        handleTranslationProcess();
      };
    }
  }, []);

  const handleTranslationProcess = async () => {
    setAppState(AppState.PROCESSING);

    try {
      const mimeType = mimeTypeRef.current;
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      
      // Secondary size check
      if (audioBlob.size < 100) {
        throw new Error("录音数据为空");
      }

      const base64Audio = await blobToBase64(audioBlob);
      
      const resultText = await translateAudio(base64Audio, mimeType);
      
      setTranslation(resultText);
      setAppState(AppState.SPEAKING);

      const detectedLang = detectLanguageFromText(resultText);
      speakText(resultText, detectedLang);
      
      setTimeout(() => {
        setAppState(AppState.IDLE);
      }, 1000);

    } catch (err: any) {
      console.error("Translation failed:", err);
      
      let displayError = "翻译失败，请重试。";
      let rawError = err.message || "";

      // Clean up error message (parse JSON if needed)
      if (rawError.includes('{')) {
        try {
            const parsed = JSON.parse(rawError.substring(rawError.indexOf('{')));
            if (parsed.error && parsed.error.message) {
                rawError = parsed.error.message;
            }
        } catch (e) {}
      }

      const isKeyError = rawError.includes("API Key") || rawError.includes("401") || rawError.includes("API_KEY_INVALID");
      const isMissingLocalKey = rawError.includes("MISSING_API_KEY_LOCAL");
      const isNetworkError = rawError.includes("Failed to fetch") || rawError.includes("NetworkError");

      if (isNetworkError) {
        displayError = "网络连接失败。请检查您的网络连接或尝试配置代理。";
      } else if (isMissingLocalKey || isKeyError) {
        setHasApiKey(false);
        // Important: Preserve the specific error message when going back to key screen
        displayError = isMissingLocalKey ? "未找到 API Key，请重新输入。" : `API Key 无效: ${rawError.replace("API_KEY_INVALID:", "")}`;
      } else if (rawError) {
        displayError = rawError;
      }
      
      setErrorMsg(displayError);
      setAppState(AppState.ERROR);
    }
  };

  if (!hasApiKey) {
    return (
      <div className="flex flex-col h-screen w-full bg-slate-50 items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-orange-100 to-transparent pointer-events-none" />
        
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm w-full text-center z-10 border border-slate-100">
          <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="material-icons-round text-3xl">settings</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">配置 Groq</h2>
          <p className="text-slate-500 mb-6 text-sm">
            请输入 API Key。如有网络问题，可配置代理地址。
            <br />
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-orange-600 underline hover:text-orange-700">
              获取免费 Key &rarr;
            </a>
          </p>
          
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 text-left break-all">
              <strong>错误:</strong> {errorMsg}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-left text-xs font-semibold text-slate-500 mb-1 ml-1">API Key</label>
              <input 
                type="text" 
                placeholder="gsk_..."
                value={tempKeyInput}
                onChange={(e) => {
                  setTempKeyInput(e.target.value);
                  setErrorMsg(null);
                }}
                className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
              />
            </div>
            
            <div>
              <label className="block text-left text-xs font-semibold text-slate-500 mb-1 ml-1">API 请求地址 (选填)</label>
              <input 
                type="text" 
                placeholder="https://api.groq.com/openai/v1"
                value={tempBaseUrl}
                onChange={(e) => setTempBaseUrl(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm text-slate-600"
              />
              <p className="text-[10px] text-left text-slate-400 mt-1 ml-1">国内用户可能需要配置代理地址以解决网络问题。</p>
            </div>

            <button
              onClick={handleSaveConfig}
              className="w-full py-3.5 px-6 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold shadow-lg shadow-orange-600/20 transition-all active:scale-95 disabled:opacity-50 mt-2"
              disabled={!tempKeyInput}
            >
              保存配置
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-orange-50 to-transparent pointer-events-none" />

      <header className="flex-none p-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <span className="bg-orange-600 text-white p-2 rounded-lg material-icons-round text-xl">bolt</span>
          <h1 className="font-bold text-slate-800 tracking-tight">Groq 极速同传</h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
             onClick={() => setHasApiKey(false)}
             className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 hover:text-orange-600 hover:border-orange-200 transition-colors shadow-sm"
             title="设置"
          >
            <span className="material-icons-round text-lg">settings</span>
          </button>
          <div className="text-xs font-medium px-3 py-1 bg-white border border-slate-200 rounded-full text-slate-500 shadow-sm flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            Llama 3
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 z-10 gap-8 max-w-lg mx-auto w-full">
        
        <div className="flex items-center gap-4 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <div className="text-center w-20">
            <div className="text-xs text-slate-400 font-semibold mb-1">输入语言</div>
            <div className="text-lg font-bold text-slate-800">自动检测</div>
          </div>
          <span className="material-icons-round text-orange-500">sync_alt</span>
          <div className="text-center w-20">
            <div className="text-xs text-slate-400 font-semibold mb-1">输出结果</div>
            <div className="text-lg font-bold text-slate-800">中英互译</div>
          </div>
        </div>

        <div className={`
          w-full min-h-[200px] flex items-center justify-center text-center p-8 
          rounded-3xl transition-all duration-500
          ${translation ? 'bg-white shadow-xl shadow-orange-900/5 scale-100 opacity-100' : 'bg-transparent scale-95 opacity-50'}
        `}>
          {errorMsg ? (
            <div className="text-red-500 flex flex-col items-center gap-2 max-w-xs mx-auto">
               <span className="material-icons-round text-3xl">error_outline</span>
               <p className="text-sm break-words font-medium">{errorMsg}</p>
               {/* 始终显示配置按钮，无论是什么错误，让用户可以修正配置 */}
               <button onClick={() => setHasApiKey(false)} className="mt-4 text-xs bg-red-50 text-red-600 px-4 py-2 rounded-full font-bold hover:bg-red-100 transition-colors">
                 {errorMsg.includes("网络") ? "配置代理地址" : "检查配置"}
               </button>
            </div>
          ) : (
             <div className="space-y-4">
               {appState === AppState.RECORDING && (
                 <p className="text-2xl font-medium text-slate-400 animate-pulse">正在聆听...</p>
               )}
               {appState === AppState.PROCESSING && (
                 <p className="text-2xl font-medium text-orange-500 animate-pulse">Groq 极速翻译中...</p>
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
                       className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-orange-600 transition-colors"
                     >
                       <span className="material-icons-round">volume_up</span>
                     </button>
                  </div>
                 </>
               )}
               {appState === AppState.IDLE && !translation && (
                 <p className="text-slate-400">长按下方按钮开始说话</p>
               )}
             </div>
          )}
        </div>

        <Waveform isRecording={appState === AppState.RECORDING} />

      </main>

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
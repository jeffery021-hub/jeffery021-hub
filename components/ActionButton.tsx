import React from 'react';
import { AppState } from '../types';

interface ActionButtonProps {
  appState: AppState;
  onStart: () => void;
  onStop: () => void;
}

export const ActionButton: React.FC<ActionButtonProps> = ({ appState, onStart, onStop }) => {
  const isRecording = appState === AppState.RECORDING;
  const isProcessing = appState === AppState.PROCESSING;

  return (
    <div className="relative group touch-none select-none">
      {/* Ripple effects */}
      {isRecording && (
        <>
          <div className="absolute inset-0 rounded-full bg-blue-400 opacity-20 animate-ping-slow"></div>
          <div className="absolute inset-0 rounded-full bg-blue-500 opacity-20 animate-pulse-slow delay-75"></div>
        </>
      )}

      {/* Main Button */}
      <button
        onMouseDown={onStart}
        onMouseUp={onStop}
        onTouchStart={(e) => {
          e.preventDefault(); // Prevent scroll/context menu on mobile
          onStart();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          onStop();
        }}
        disabled={isProcessing}
        className={`
          relative w-24 h-24 rounded-full flex items-center justify-center 
          shadow-xl transition-all duration-200 transform
          ${isRecording 
            ? 'bg-red-500 scale-110 ring-4 ring-red-200' 
            : 'bg-gradient-to-br from-blue-500 to-blue-600 active:scale-95 hover:shadow-blue-500/30'}
          ${isProcessing ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {isProcessing ? (
          <span className="material-icons-round text-white text-4xl animate-spin">
            sync
          </span>
        ) : (
          <span className="material-icons-round text-white text-4xl">
            {isRecording ? 'mic_off' : 'mic'}
          </span>
        )}
      </button>
      
      <div className="mt-6 text-center">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-widest">
          {isRecording ? 'Release to Translate' : isProcessing ? 'Translating...' : 'Hold to Speak'}
        </p>
      </div>
    </div>
  );
};
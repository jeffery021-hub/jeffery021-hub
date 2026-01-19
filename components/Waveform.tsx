import React from 'react';

interface WaveformProps {
  isRecording: boolean;
}

export const Waveform: React.FC<WaveformProps> = ({ isRecording }) => {
  if (!isRecording) return <div className="h-16 w-full" />;

  return (
    <div className="flex items-center justify-center h-16 gap-1">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="w-1.5 bg-blue-500 rounded-full animate-music"
          style={{
            height: '20%',
            animationDuration: `${0.5 + i * 0.1}s`,
            animationName: 'musicWave'
          }}
        />
      ))}
      <style>{`
        @keyframes musicWave {
          0%, 100% { height: 20%; opacity: 0.5; }
          50% { height: 80%; opacity: 1; }
        }
        .animate-music {
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }
      `}</style>
    </div>
  );
};
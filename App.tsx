import React, { useState, useEffect } from 'react';
import { useLiveSession, SessionConfig } from './hooks/useLiveSession';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const { 
    isConnected, 
    isConnecting, 
    error, 
    mode, 
    audioAnalyzerRef, 
    connect, 
    disconnect 
  } = useLiveSession();

  // --- Configuration State ---
  const [config, setConfig] = useState<SessionConfig>({
    apiKey: process.env.API_KEY || localStorage.getItem('gemini_api_key') || "",
    userName: localStorage.getItem('rina_user_name') || "",
    userGender: localStorage.getItem('rina_user_gender') || "指定なし",
    relationship: localStorage.getItem('rina_relationship') || "友達",
  });

  const [showConfig, setShowConfig] = useState(false);
  
  // Check if we have enough info to start
  const isConfigValid = !!config.apiKey && !!config.userName;

  // PWA Install Prompt State
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    // If no key or no name, show config automatically on load
    if (!config.apiKey || !config.userName) {
      setShowConfig(true);
    }
  }, []);

  // Handle PWA Install Prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    setInstallPrompt(null);
  };

  const handleConfigChange = (field: keyof SessionConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (config.apiKey && config.userName) {
      localStorage.setItem('gemini_api_key', config.apiKey.trim());
      localStorage.setItem('rina_user_name', config.userName.trim());
      localStorage.setItem('rina_user_gender', config.userGender);
      localStorage.setItem('rina_relationship', config.relationship);
      setShowConfig(false);
    }
  };

  const handleToggleConnection = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect(config);
    }
  };

  // Prevent screen from sleeping on mobile while connected
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isConnected) {
        try {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        } catch (err) {
          // Suppress error logging for permission policy issues common in iframes
          console.debug('Wake Lock failed (likely due to permissions policy):', err);
        }
      }
    };
    
    if (isConnected) {
      requestWakeLock();
    }
    
    return () => {
      if (wakeLock) wakeLock.release();
    };
  }, [isConnected]);

  return (
    <div className="min-h-[100dvh] h-[100dvh] bg-black text-white overflow-hidden relative selection:bg-pink-500 selection:text-white flex flex-col">
      {/* Background Ambience */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-blue-900 rounded-full blur-[150px] animate-pulse"></div>
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-purple-900 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="relative z-10 flex flex-col h-full safe-area-inset">
        {/* Header */}
        <header className="p-4 md:p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pt-[calc(1rem+env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-pink-400 rounded-full shadow-[0_0_10px_#f472b6]"></div>
            <h1 className="text-xl font-light tracking-widest uppercase">Rina <span className="text-xs opacity-70 ml-1 text-pink-300">AI</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
             {installPrompt && (
               <button 
                  onClick={handleInstallClick}
                  className="hidden md:block text-xs text-pink-400 hover:text-pink-300 transition-colors uppercase tracking-widest font-mono border border-pink-500/30 px-3 py-1 rounded"
               >
                 INSTALL
               </button>
             )}

             <button 
                onClick={() => setShowConfig(!showConfig)}
                disabled={isConnected}
                className={`text-xs transition-colors uppercase tracking-widest font-mono ${isConnected ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:text-white'}`}
             >
               {showConfig ? 'CLOSE' : 'SETUP'}
             </button>
             <div className="text-xs font-mono text-zinc-500 flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></span>
             </div>
          </div>
        </header>

        {/* Main Visualizer Area */}
        <main className="flex-grow flex items-center justify-center relative w-full overflow-hidden">
          <div className="w-full max-w-2xl aspect-square relative flex items-center justify-center">
             
             {/* Configuration Overlay */}
             {showConfig && !isConnected && (
                <div className="absolute z-30 w-full max-w-sm h-[80vh] max-h-[600px] overflow-y-auto px-6 py-8 bg-black/95 backdrop-blur-xl border border-zinc-800 rounded-2xl flex flex-col gap-6 shadow-2xl fade-in mx-4">
                  <div className="text-center space-y-2 shrink-0">
                    <h2 className="text-lg font-light tracking-widest text-white uppercase">Profile Setup</h2>
                    <p className="text-xs text-zinc-400">
                      Rina needs to know a little about you.
                    </p>
                  </div>
                  
                  <form onSubmit={handleSaveConfig} className="flex flex-col gap-5 flex-grow">
                    
                    {/* API Key */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Gemini API Key</label>
                      <input 
                        type="password" 
                        value={config.apiKey}
                        onChange={(e) => handleConfigChange('apiKey', e.target.value)}
                        placeholder="AIza..."
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500/50 transition-all text-white placeholder-zinc-700"
                      />
                    </div>

                    {/* Name */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Your Name</label>
                      <input 
                        type="text" 
                        value={config.userName}
                        onChange={(e) => handleConfigChange('userName', e.target.value)}
                        placeholder="What should she call you?"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500/50 transition-all text-white placeholder-zinc-700"
                      />
                    </div>

                    {/* Gender */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Your Gender</label>
                      <select 
                        value={config.userGender}
                        onChange={(e) => handleConfigChange('userGender', e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-pink-500 text-white appearance-none"
                      >
                         <option value="指定なし">Unspecified (指定なし)</option>
                         <option value="男性">Male (男性)</option>
                         <option value="女性">Female (女性)</option>
                         <option value="その他">Other (その他)</option>
                      </select>
                    </div>

                    {/* Relationship */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Relationship with Rina</label>
                      <select 
                        value={config.relationship}
                        onChange={(e) => handleConfigChange('relationship', e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-pink-500 text-white appearance-none"
                      >
                         <option value="友達">Friend (友達)</option>
                         <option value="親友">Best Friend (親友)</option>
                         <option value="恋人">Lover (恋人)</option>
                         <option value="妹">Sister (妹として接する)</option>
                         <option value="先輩後輩">Senpai/Kouhai (先輩後輩)</option>
                      </select>
                    </div>

                    <div className="pt-4 mt-auto">
                      <button 
                        type="submit"
                        disabled={!config.apiKey || !config.userName}
                        className="w-full bg-white text-black py-3 rounded-lg text-xs font-bold tracking-widest hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase"
                      >
                        Save & Ready
                      </button>
                    </div>
                  </form>
                  
                  <div className="shrink-0 text-center">
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[10px] text-zinc-600 hover:text-zinc-400 underline">Need an API Key?</a>
                  </div>
                </div>
             )}

             {/* Status Text overlay */}
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none text-center fade-in w-full px-4">
                {!isConnected && !isConnecting && !error && isConfigValid && !showConfig && (
                  <p className="text-zinc-500 text-sm tracking-widest animate-pulse">
                    READY
                  </p>
                )}
                {isConnecting && (
                   <p className="text-pink-400 text-sm tracking-widest animate-pulse">CONNECTING TO RINA...</p>
                )}
                {error && (
                   <p className="text-red-400 text-sm tracking-wide bg-red-900/20 px-4 py-2 rounded border border-red-900/50">{error}</p>
                )}
             </div>

             {/* The Visualizer */}
             <div className={`w-full h-full transition-opacity duration-1000 ${isConnected ? 'opacity-100' : 'opacity-30 blur-sm'}`}>
                <Visualizer 
                  isActive={isConnected} 
                  analyzerRef={audioAnalyzerRef} 
                  mode={mode} 
                />
             </div>
          </div>
        </main>

        {/* Controls */}
        <footer className="p-6 md:p-8 flex flex-col items-center gap-4 md:gap-6 mb-4 md:mb-8 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          
          <div className="text-center space-y-2 h-12 flex flex-col justify-center">
            {isConnected && (
              <p className="text-pink-200 text-sm font-light fade-in">
                {mode === 'listening' ? "Listening..." : mode === 'speaking' ? "Speaking..." : "Thinking..."}
              </p>
            )}
            {!isConnected && !isConnecting && isConfigValid && !showConfig && (
               <p className="text-zinc-500 text-xs md:text-sm max-w-md mx-auto">
                 Tap to start talking with Rina.
               </p>
            )}
            {installPrompt && !isConnected && (
               <button onClick={handleInstallClick} className="md:hidden text-pink-400 text-xs underline decoration-pink-500/30 underline-offset-4">
                 Install App
               </button>
            )}
          </div>

          <button
            onClick={handleToggleConnection}
            disabled={isConnecting || !isConfigValid || showConfig}
            className={`
              relative group overflow-hidden px-12 py-5 rounded-full font-semibold tracking-wider text-sm transition-all duration-300 touch-manipulation
              ${isConnected 
                ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20 active:scale-95' 
                : 'bg-white text-black hover:scale-105 active:scale-95 hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]'}
              disabled:opacity-20 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
            `}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <span className="relative z-10">
              {isConnecting ? 'CONNECTING...' : isConnected ? 'DISCONNECT' : 'CALL RINA'}
            </span>
            {!isConnected && !isConnecting && isConfigValid && (
              <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent z-0"></div>
            )}
          </button>
          
        </footer>
      </div>
    </div>
  );
};

export default App;
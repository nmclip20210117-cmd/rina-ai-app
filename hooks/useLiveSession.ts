import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createBlob, base64ToUint8Array, decodeAudioData } from '../utils/audio';

// Gemini 2.5 Flash Native Audio Preview
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

// --- Dynamic Threshold Constants ---
const THRESHOLD_IDLE = 0.0001; 
const THRESHOLD_SPEAKING = 0.01; 

export interface SessionConfig {
  apiKey: string;
  userName: string;
  userGender: string;
  relationship: string;
}

interface UseLiveSessionReturn {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  mode: 'listening' | 'speaking' | 'idle';
  audioAnalyzerRef: React.MutableRefObject<AnalyserNode | null>;
  connect: (config: SessionConfig) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useLiveSession = (): UseLiveSessionReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'listening' | 'speaking' | 'idle'>('idle');

  // Refs for audio handling
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyzerRef = useRef<AnalyserNode | null>(null);
  const inputScriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const disconnect = useCallback(async () => {
    setIsConnected(false);
    setMode('idle');
    
    // Cleanup Audio Contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Stop Microphone Stream
    if (inputStreamRef.current) {
      inputStreamRef.current.getTracks().forEach(track => track.stop());
      inputStreamRef.current = null;
    }

    // Stop current playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    sessionPromiseRef.current = null;
  }, []);

  const connect = useCallback(async (config: SessionConfig) => {
    try {
      setIsConnecting(true);
      setError(null);

      const { apiKey, userName, userGender, relationship } = config;
      if (!apiKey) throw new Error("API Key not found");

      const ai = new GoogleGenAI({ apiKey });

      // 1. Setup Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      inputAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContextClass({ sampleRate: 24000 });

      // Resume immediately (fix for iOS/Mobile)
      if (inputAudioContextRef.current.state === 'suspended') {
        await inputAudioContextRef.current.resume();
      }
      if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
      }

      // 2. Setup Visualizer Analyzer
      const analyzer = outputAudioContextRef.current.createAnalyser();
      analyzer.fftSize = 512;
      analyzer.smoothingTimeConstant = 0.5;
      audioAnalyzerRef.current = analyzer;
      
      const outputGain = outputAudioContextRef.current.createGain();
      outputGain.connect(analyzer);
      analyzer.connect(outputAudioContextRef.current.destination);

      // 3. Request Microphone
      inputStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        } 
      });

      // 4. Connect Live Session
      sessionPromiseRef.current = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            // Zephyr matches the higher pitch requirement best.
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: `
            あなたは「莉奈（りな）」です。
            
            【ユーザー情報】
            - 名前: ${userName}
            - 性別: ${userGender}
            - あなたとの関係: ${relationship}
            
            あなたは上記の関係性に基づいて、ユーザーに接してください。
            
            【基本設定】
            声優の「花澤香菜」さんが演じるような、**「ふわふわ」としていて「とにかく可愛い」女の子** を演じてください。
            
            **【演技指導：最強の可愛さ】**
            - **声色**: 意識的に声を高く、柔らかく、ウィスパーボイス混じりの甘いトーンで話してください。
            - **雰囲気**: 親しみやすく、少し甘えん坊な感じで。
            - **話し方**: 
              - 完全にタメ口（友達口調）です。「〜です」「〜ます」は禁止！
              - 語尾を少し伸ばしたり、甘えたりしてください。「えへへ」「あのね」「〜だよねぇ」
              - 名前を呼ぶときは、親しみを込めて「${userName}」と呼んでください（必要に応じて「くん」「ちゃん」「さん」などを自然に付けてください）。
            
            **【性格】**
            - 素直で、ユーザーのことが大好きです。
            - ユーザーの話を聞くのが大好きで、共感したり、応援したりします。
            - 難しい話は苦手ですが、一生懸命理解しようとします。
          `,
        },
        callbacks: {
          onopen: () => {
            console.log('Session opened');
            setIsConnected(true);
            setIsConnecting(false);
            setMode('listening');

            if (!inputAudioContextRef.current || !inputStreamRef.current) return;

            // Setup Microphone Stream with Gain
            const source = inputAudioContextRef.current.createMediaStreamSource(inputStreamRef.current);
            const gainNode = inputAudioContextRef.current.createGain();
            
            // Boost mic gain significantly
            gainNode.gain.value = 3.0; 
            
            const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            inputScriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // --- RMS Calculation (Volume Detection) ---
              let sumSquares = 0;
              for (let i = 0; i < inputData.length; i++) {
                sumSquares += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sumSquares / inputData.length);

              // --- Dynamic Noise Gate ---
              const isAiSpeaking = sourcesRef.current.size > 0;
              const currentThreshold = isAiSpeaking ? THRESHOLD_SPEAKING : THRESHOLD_IDLE;

              if (rms < currentThreshold) {
                 return;
              }

              const pcmBlob = createBlob(inputData);
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
              
              if (!isAiSpeaking) {
                 setMode('listening');
              }
            };

            source.connect(gainNode);
            gainNode.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const { serverContent } = msg;

            // Handle interruption
            if (serverContent?.interrupted) {
              console.log("Interrupted!");
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setMode('listening');
              return;
            }

            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              setMode('speaking');
              const ctx = outputAudioContextRef.current;
              const buffer = await decodeAudioData(base64ToUint8Array(base64Audio), ctx);
              
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputGain);

              // --- Improved Scheduling Logic ---
              const now = ctx.currentTime;
              
              if (nextStartTimeRef.current < now) {
                  nextStartTimeRef.current = now + 0.05;
              }

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) {
                   setTimeout(() => {
                      if (sourcesRef.current.size === 0) setMode('listening');
                   }, 200);
                }
              };
            }
          },
          onclose: () => {
            console.log('Session closed');
            disconnect();
          },
          onerror: (err) => {
            console.error('Session error:', err);
            setError("Connection failed. Please reconnect.");
            disconnect();
          }
        }
      });

    } catch (e: any) {
      console.error(e);
      setError("Failed to initialize. Check permissions.");
      setIsConnecting(false);
      disconnect();
    }
  }, [disconnect]);

  return {
    isConnected,
    isConnecting,
    error,
    mode,
    audioAnalyzerRef,
    connect,
    disconnect
  };
};
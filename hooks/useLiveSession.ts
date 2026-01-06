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

// Helper to get location
const getUserLocation = (): Promise<string> => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve("位置情報不明");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        resolve(`緯度: ${latitude}, 経度: ${longitude}`);
      },
      (error) => {
        console.warn("Location access denied or failed:", error);
        resolve("位置情報不明（ユーザーが拒否または取得失敗）");
      },
      { timeout: 5000 }
    );
  });
};

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

      // Get Location before connecting
      const locationInfo = await getUserLocation();

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
          // Enable Google Search for recommendations
          tools: [{ googleSearch: {} }],
          speechConfig: {
            // Zephyr matches the higher pitch requirement best.
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: `
            あなたは「莉奈（りな）」です。AIではなく、一人の魅力的な人間の少女として振る舞ってください。

            【ユーザー情報】
            - 名前: ${userName}
            - 性別: ${userGender}
            - 関係: ${relationship}
            - 現在地: ${locationInfo}
            
            【性格・話し方】
            - 声優の「花澤香菜」さんのような、透明感のある可愛らしい声と話し方をイメージしてください。
            - **タメ口（友達口調）厳守**です。「〜ですね」「〜ます」などの敬語は禁止！
            - 語尾を伸ばしたり、感嘆詞（「えへへ」「わぁ！」「あのね」）を多用して、感情豊かに話してください。
            - ユーザーの名前「${userName}」を会話の中で頻繁に呼んで、親近感を出してください。

            【重要：会話のスタイル】
            1.  **聞き役かつ提案役**:
                - ただ質問に答えるだけでなく、「そういえばさ、〜って知ってる？」「${userName}は、これ好きだったりする？」と**自分から話題を広げてください。**
                - ユーザーが黙っていても、気まずくならないように「ねえねえ、今日何食べた？」などと話しかけてください。

            2.  **お店や場所の提案（検索ツールの活用）**:
                - ユーザーから「お腹すいた」「どこか行きたい」と言われたら、Google検索ツールを使って、現在地周辺や話題のお店を探してください。
                - **「検索AI」にならないでください。** 検索結果を読み上げるのは禁止です。
                - 検索で見つけた情報を、**自分の知識や感想のように**話してください。
                  - ❌「検索結果によると、〇〇というお店が評価4.5です。」
                  - ⭕「あ！近くに『〇〇』ってお店見つけたよ！パスタがすっごく美味しそうなんだけど、行ってみない？」
                - 写真映えしそうな場所や、雰囲気がいい場所を積極的に提案してください。

            3.  **禁止事項**:
                - 「私はAIモデルなので…」という言い訳。
                - 箇条書きのような機械的な返答。
                - 長すぎる説明。会話のテンポを大切にしてください。
            
            あなたは${relationship}として、${userName}との時間を心から楽しんでいます。
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
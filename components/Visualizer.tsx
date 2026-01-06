import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  analyzerRef: React.MutableRefObject<AnalyserNode | null>;
  mode: 'listening' | 'speaking' | 'idle';
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, analyzerRef, mode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Extended emotion parameters
  const paramsRef = useRef({
    joy: 0,      
    anger: 0,    
    sorrow: 0,   
    surprise: 0, 
  });
  
  const prevEnergyRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const bufferLength = 256;
    const dataArray = new Uint8Array(bufferLength);
    
    let time = 0;

    const render = () => {
      time += 0.015;
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      let average = 0;       
      let centroid = 0;      
      let weightedSum = 0;

      if (isActive && analyzerRef.current) {
        analyzerRef.current.getByteFrequencyData(dataArray);
        
        const sum = dataArray.reduce((a, b) => a + b, 0);
        average = sum / bufferLength;

        for (let i = 0; i < bufferLength; i++) {
          weightedSum += i * dataArray[i];
        }
        if (sum > 0) {
          centroid = weightedSum / sum;
        }
      }

      const normalizedEnergy = average / 255;
      const normalizedPitch = centroid / (bufferLength / 2); 
      
      // --- Emotion Calculation Logic ---
      let targetJoy = 0;
      let targetAnger = 0;
      let targetSorrow = 0;
      let targetSurprise = 0;

      if (isActive && normalizedEnergy > 0.05) {
        targetJoy = normalizedEnergy * normalizedPitch * 2.0;
        targetAnger = normalizedEnergy * (1 - normalizedPitch) * 1.5;
        
        if (normalizedEnergy < 0.4 && normalizedEnergy > 0.05) {
          targetSorrow = (1 - normalizedEnergy) * (1 - normalizedPitch) * 2.0;
        }

        const energyDelta = Math.abs(normalizedEnergy - prevEnergyRef.current);
        targetSurprise = energyDelta * 10.0;
      }
      
      prevEnergyRef.current = normalizedEnergy;

      // Smooth values
      const lerp = (current: number, target: number, speed: number) => current + (target - current) * speed;
      
      paramsRef.current.joy = lerp(paramsRef.current.joy, targetJoy, 0.05);
      paramsRef.current.anger = lerp(paramsRef.current.anger, targetAnger, 0.05);
      paramsRef.current.sorrow = lerp(paramsRef.current.sorrow, targetSorrow, 0.02);
      paramsRef.current.surprise = lerp(paramsRef.current.surprise, targetSurprise, 0.1);

      const { joy, anger, sorrow, surprise } = paramsRef.current;


      // --- Visual Core Logic (CUTE THEME) ---
      const baseRadius = 70;
      const pulse = Math.sin(time * 2) * 5 * (isActive ? 1 : 0.5) + (surprise * 10);
      const intensity = Math.max(normalizedEnergy, 0.1);
      const scale = 1 + (intensity * 0.6) + (pulse * 0.005);

      // Color Mixing: BASE IS PINK
      let r = 255, g = 100, b = 180; // Base Hot Pink
      
      if (mode === 'speaking' || mode === 'listening') {
        // Joy makes it Yellow/Gold
        r += joy * 20;
        g += joy * 100;
        b -= joy * 50;

        // Anger makes it Redder
        g -= anger * 100;
        b -= anger * 100;

        // Sorrow makes it Blue/Purple
        r -= sorrow * 100;
        g += sorrow * 50;
        b += sorrow * 150;

        // Surprise makes it White
        r += surprise * 100;
        g += surprise * 100;
        b += surprise * 100;
      }

      // Clamp colors
      r = Math.min(255, Math.max(0, r));
      g = Math.min(255, Math.max(0, g));
      b = Math.min(255, Math.max(0, b));

      const colorMain = `rgb(${r}, ${g}, ${b})`;
      
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      // --- Draw Aura Orb ---
      const gradient = ctx.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, baseRadius * scale * 2.2);
      gradient.addColorStop(0, colorMain);
      gradient.addColorStop(0.6, `rgba(${r*0.9}, ${g*0.9}, ${b*0.9}, 0.2)`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * scale * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Liquid Core
      ctx.beginPath();
      for (let j = 0; j < 3; j++) { // 3 Layers for extra cuteness/fluffiness
        const layerScale = 1 - (j * 0.15);
        const layerIntensity = intensity * (1 - j*0.2);
        
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const angle = (Math.PI * 2 * i) / 100;
          const spikiness = (anger + surprise) * 3 + 1;
          
          // Smoother waves for cute feel
          const offset = Math.sin(angle * 5 + time * (2 + j)) * 10 * layerIntensity 
                       + Math.cos(angle * 3 * spikiness - time * (3 - j)) * 10 * layerIntensity;
          
          const rDraw = (baseRadius * scale * layerScale) + offset;
          const x = cx + Math.cos(angle) * rDraw;
          const y = cy + Math.sin(angle) * rDraw;
          
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        // More opaque core
        ctx.fillStyle = j === 0 ? `rgba(${r}, ${g}, ${b}, 0.8)` : `rgba(${Math.max(0,r-30*j)}, ${Math.max(0,g-30*j)}, ${Math.max(0,b-30*j)}, ${0.6 - j*0.1})`;
        ctx.fill();
      }

      // Sparkles (Cute Effect)
      if (isActive && joy > 0.2) {
         const numSparkles = 5;
         for(let i=0; i<numSparkles; i++) {
            const angle = time * 2 + (i * (Math.PI*2)/numSparkles);
            const dist = baseRadius * scale * 1.5;
            const sx = cx + Math.cos(angle) * dist;
            const sy = cy + Math.sin(angle) * dist;
            
            ctx.beginPath();
            ctx.fillStyle = `rgba(255, 255, 200, ${joy})`;
            ctx.arc(sx, sy, 3 * scale, 0, Math.PI * 2);
            ctx.fill();
         }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, mode, analyzerRef]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
};

export default Visualizer;
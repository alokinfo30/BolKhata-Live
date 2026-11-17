import React, { useEffect, useRef } from 'react';

interface VoiceWaveformProps {
  isConnected: boolean;
  isMuted: boolean;
  micLevel: number;
  isAgentSpeaking: boolean;
}

export const VoiceWaveform: React.FC<VoiceWaveformProps> = ({
  isConnected,
  isMuted,
  micLevel,
  isAgentSpeaking,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
  const speakingRef = useRef(false);
  const connectedRef = useRef(false);
  const mutedRef = useRef(false);

  levelRef.current = micLevel;
  speakingRef.current = isAgentSpeaking;
  connectedRef.current = isConnected;
  mutedRef.current = isMuted;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let phase = 0;
    const barCount = 36;
    const heights = new Float32Array(barCount).fill(0.08);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      phase += 0.14;
      const activeEnergy = !connectedRef.current
        ? 0.04
        : speakingRef.current
        ? 0.55 + Math.sin(phase * 1.3) * 0.2
        : mutedRef.current
        ? 0.05
        : Math.max(0.08, Math.min(1, levelRef.current * 3.2));

      const barGap = 4;
      const totalBarWidth = width / barCount;
      const barWidth = Math.max(2, totalBarWidth - barGap);

      for (let i = 0; i < barCount; i++) {
        const distFromCenter = Math.abs(i - barCount / 2) / (barCount / 2);
        const envelope = Math.max(0.2, 1 - distFromCenter * 0.75);
        const wave = Math.sin(phase + i * 0.45) * 0.5 + 0.5;
        const target = Math.min(0.95, 0.08 + activeEnergy * envelope * (0.4 + 0.6 * wave));
        heights[i] += (target - heights[i]) * 0.28;

        const barH = Math.max(4, heights[i] * (height - 8));
        const x = i * totalBarWidth + barGap / 2;
        const y = (height - barH) / 2;

        if (!connectedRef.current) {
          ctx.fillStyle = '#CBD5E1';
        } else if (speakingRef.current) {
          ctx.fillStyle = '#15803D';
        } else if (mutedRef.current) {
          ctx.fillStyle = '#94A3B8';
        } else {
          ctx.fillStyle = '#1D4ED8';
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 2);
        ctx.fill();
      }

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-14 block"
      aria-label="Live counter audio activity visualizer"
    />
  );
};

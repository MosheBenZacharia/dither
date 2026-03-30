"use client";

import { useRef, useEffect, useCallback } from "react";
import { useDialKit } from "dialkit";
import {
  type DitherAlgorithm,
  floydSteinberg,
  bayerDither,
  blueNoiseDither,
  generateBlueNoise,
  invertWithMask,
} from "@/lib/dither-algorithms";
import { processImage, loadImage } from "@/lib/image-processing";
import {
  createDotSystem,
  updateDots,
  renderDots,
  type DotSystem,
  type Shockwave,
} from "@/lib/particle-system";
import { useIsMobile } from "@/lib/use-is-mobile";

interface ParticleCanvasProps {
  imageSrc: string;
  onUploadRequest: () => void;
  onLogoPresetChange: (src: string) => void;
}

const GRID_SIZE = 300;
const IDLE_DELAY = 3500; // ms before idle orbit starts
const IDLE_SPEED = 0.35; // radians/sec (~18s per full orbit)

const LOGO_PRESETS = {
  linear: "/linear-app-icon.png",
  cube: "/CUBE_2D_LIGHT.png",
} as const;

export default function ParticleCanvas({
  imageSrc,
  onUploadRequest,
  onLogoPresetChange,
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const systemRef = useRef<DotSystem | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const shockwavesRef = useRef<Shockwave[]>([]);
  const animFrameRef = useRef<number>(0);
  const runningRef = useRef(false);
  const blueNoiseRef = useRef<Uint8Array | null>(null);
  const prevConfigRef = useRef<string>("");
  const gridDimsRef = useRef({ w: GRID_SIZE, h: GRID_SIZE });
  const colorRef = useRef(false);

  // Idle orbit state
  const imageBoundsRef = useRef({ cx: 0, cy: 0, hw: 0, hh: 0 });
  const idleActiveRef = useRef(false);
  const idleAngleRef = useRef(Math.PI * 1.5); // start at top of image
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTickTimeRef = useRef(0);
  const startLoopRef = useRef<() => void>(() => {});

  const isMobile = useIsMobile();

  const params = useDialKit("Dither Playground", {
    algorithm: {
      type: "select",
      options: ["floyd-steinberg", "bayer", "blue-noise"],
      default: "floyd-steinberg",
    },
    scale: [0.35, 0.1, 2.0, 0.05],
    dotScale: [1, 0.5, 10, 0.5],
    invert: true,
    color: true,

    logo: {
      type: "select",
      options: ["linear", "cube"],
      default: "linear",
    },

    image: {
      _collapsed: true,
      threshold: [181, 0, 255, 1],
      contrast: [0, -100, 100, 1],
      gamma: [1.03, 0.1, 3.0, 0.01],
      blur: [3.75, 0, 20, 0.25],
      highlightsCompression: [0, 0, 1, 0.01],
    },

    dither: {
      _collapsed: true,
      errorStrength: [1.0, 0, 2.0, 0.01],
      serpentine: true,
    },

    shape: {
      _collapsed: true,
      cornerRadius: [0.28, 0, 0.5, 0.01],
    },

    upload: { type: "action" },
  }, {
    onAction: (action) => {
      if (action === "upload") onUploadRequest();
    },
  });

  const algorithm = params.algorithm as DitherAlgorithm;
  colorRef.current = params.color;

  const isMountedRef = useRef(false);
  useEffect(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }
    const key = params.logo as keyof typeof LOGO_PRESETS;
    const path = LOGO_PRESETS[key] ?? LOGO_PRESETS.linear;
    onLogoPresetChange(path);
  }, [params.logo, onLogoPresetChange]);

  const startLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    const tick = () => {
      const sys = systemRef.current;
      if (!sys) {
        runningRef.current = false;
        return;
      }

      const now = performance.now();
      const dt = lastTickTimeRef.current > 0
        ? Math.min((now - lastTickTimeRef.current) / 1000, 0.05)
        : 0.016;
      lastTickTimeRef.current = now;

      // Idle orbit: simulate mouse moving clockwise around the image edge
      if (idleActiveRef.current) {
        idleAngleRef.current += IDLE_SPEED * dt;
        const { cx, cy, hw, hh } = imageBoundsRef.current;
        mouseRef.current.x = cx + hw * Math.cos(idleAngleRef.current);
        mouseRef.current.y = cy + hh * Math.sin(idleAngleRef.current);
        mouseRef.current.active = true;
      }

      const rect = canvas.getBoundingClientRect();
      const needsMore = updateDots(
        sys,
        mouseRef.current.x,
        mouseRef.current.y,
        mouseRef.current.active,
        shockwavesRef.current,
        now
      );

      renderDots(ctx, sys, params.invert, rect.width, rect.height, dpr, params.color);

      if (needsMore || idleActiveRef.current) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        runningRef.current = false;
        lastTickTimeRef.current = 0;
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [params.invert, params.color]);

  // Keep startLoopRef current so idle timer always calls the latest version
  useEffect(() => {
    startLoopRef.current = startLoop;
  }, [startLoop]);

  const scheduleIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      idleActiveRef.current = true;
      startLoopRef.current();
    }, IDLE_DELAY);
  }, []);

  const cancelIdle = useCallback(() => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    idleActiveRef.current = false;
  }, []);

  const rebuildParticles = useCallback(
    async (src: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      let positions: Float32Array;
      let gw = GRID_SIZE;
      let gh = GRID_SIZE;

      const img = await loadImage(src);

      const processed = processImage(
        img,
        GRID_SIZE,
        1,
        params.image.contrast,
        params.image.gamma,
        params.image.blur,
        params.image.highlightsCompression
      );

      gw = processed.width;
      gh = processed.height;
      const opts = {
        threshold: params.image.threshold,
        serpentine: params.dither.serpentine,
        errorStrength: params.dither.errorStrength,
      };

      switch (algorithm) {
        case "floyd-steinberg":
          positions = floydSteinberg(processed.grayscale, processed.width, processed.height, opts, processed.alpha);
          break;
        case "bayer":
          positions = bayerDither(processed.grayscale, processed.width, processed.height, opts, processed.alpha);
          break;
        case "blue-noise": {
          if (!blueNoiseRef.current) blueNoiseRef.current = generateBlueNoise(256);
          positions = blueNoiseDither(processed.grayscale, processed.width, processed.height, blueNoiseRef.current, 256, opts, processed.alpha);
          break;
        }
      }

      if (params.invert) {
        positions = invertWithMask(positions, processed.width, processed.height, params.shape.cornerRadius, processed.alpha);
      }

      gridDimsRef.current = { w: gw, h: gh };

      const s = Math.max(0.5, Math.min(rect.width, rect.height) * params.scale / Math.max(gw, gh));
      const ox = Math.round((rect.width - gw * s) / 2);
      const oy = Math.round((rect.height - gh * s) / 2);

      imageBoundsRef.current = {
        cx: ox + (gw * s) / 2,
        cy: oy + (gh * s) / 2,
        hw: (gw * s) / 2,
        hh: (gh * s) / 2,
      };

      const dotScale = isMobile ? params.dotScale * 0.8 : params.dotScale;

      systemRef.current = createDotSystem(positions, s, dotScale, ox, oy, processed.colors, processed.width);
      startLoop();
      scheduleIdle();
    },
    [algorithm, params.scale, params.dotScale, params.image.contrast, params.image.gamma, params.image.blur, params.image.threshold, params.image.highlightsCompression, params.dither.errorStrength, params.dither.serpentine, params.shape.cornerRadius, params.invert, isMobile, startLoop, scheduleIdle]
  );

  useEffect(() => {
    const configKey = JSON.stringify([imageSrc, algorithm, params.scale, params.dotScale, params.image, params.dither, params.shape, params.invert, isMobile]);
    if (configKey === prevConfigRef.current) return;
    prevConfigRef.current = configKey;
    rebuildParticles(imageSrc);
  }, [imageSrc, algorithm, rebuildParticles, params.scale, params.dotScale, params.image, params.dither, params.shape, params.invert, isMobile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = 0;
    let lastHeight = 0;

    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const sys = systemRef.current;
      if (sys) renderDots(ctx, sys, params.invert, rect.width, rect.height, dpr, colorRef.current);

      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (lastWidth !== 0 && (w !== lastWidth || h !== lastHeight)) {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => rebuildParticles(imageSrc), 200);
      }
      lastWidth = w;
      lastHeight = h;
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);

    const handlePointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mouseRef.current.x = mx;
      mouseRef.current.y = my;

      // Only cancel idle and activate mouse when close enough to the image to affect particles
      const { cx, cy, hw, hh } = imageBoundsRef.current;
      const MOUSE_RADIUS = 100;
      const nearX = Math.max(0, Math.abs(mx - cx) - hw);
      const nearY = Math.max(0, Math.abs(my - cy) - hh);
      const distToImage = Math.sqrt(nearX * nearX + nearY * nearY);

      if (distToImage < MOUSE_RADIUS) {
        cancelIdle();
        mouseRef.current.active = true;
      } else {
        mouseRef.current.active = false;
        if (!idleActiveRef.current && !idleTimerRef.current) {
          scheduleIdle();
        }
      }
      startLoop();
    };

    const handlePointerLeave = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      mouseRef.current.active = false;
      startLoop();
      if (!idleActiveRef.current) scheduleIdle();
    };

    const handlePointerCancel = () => {
      mouseRef.current.active = false;
      startLoop();
    };

    const handlePointerUp = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      shockwavesRef.current.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        start: performance.now(),
      });
      if (e.pointerType !== "mouse") {
        mouseRef.current.active = false;
      }
      startLoop();
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("pointerup", handlePointerUp);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      runningRef.current = false;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointerup", handlePointerUp);
    };
  }, [params.invert, startLoop, rebuildParticles, imageSrc, scheduleIdle, cancelIdle]);

  // Re-render when color mode toggles without rebuilding particles
  useEffect(() => {
    startLoop();
  }, [params.color, startLoop]);

  const bg = "#FAFAF8";

  useEffect(() => {
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  }, [bg]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block touch-none"
      style={{ cursor: "default", background: bg }}
    />
  );
}

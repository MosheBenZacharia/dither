export interface ProcessedImage {
  grayscale: Uint8Array;
  colors: Uint8Array; // RGB per pixel, 3 bytes each
  alpha: Uint8Array;
  width: number;
  height: number;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Scale image to fit within maxDimension while preserving aspect ratio,
 * then sample at every `scale` pixels to create the dot grid.
 */
export function processImage(
  img: HTMLImageElement,
  maxDimension: number,
  scale: number,
  contrast: number,
  gamma: number,
  blur: number,
  highlightsCompression = 0
): ProcessedImage {
  const aspect = img.naturalWidth / img.naturalHeight;
  let outW: number, outH: number;
  if (aspect >= 1) {
    outW = maxDimension;
    outH = Math.round(maxDimension / aspect);
  } else {
    outH = maxDimension;
    outW = Math.round(maxDimension * aspect);
  }

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  // Get alpha mask from the unblurred image so edges stay crisp
  const alphaCanvas = document.createElement("canvas");
  alphaCanvas.width = outW;
  alphaCanvas.height = outH;
  const alphaCtx = alphaCanvas.getContext("2d")!;
  alphaCtx.imageSmoothingEnabled = true;
  alphaCtx.imageSmoothingQuality = "high";
  alphaCtx.drawImage(img, 0, 0, outW, outH);
  const alphaData = alphaCtx.getImageData(0, 0, outW, outH).data;

  // Apply blur at source resolution with padding to avoid edge darkening
  const pad = Math.ceil(blur * 3);
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW + pad * 2;
  srcCanvas.height = srcH + pad * 2;
  const srcCtx = srcCanvas.getContext("2d")!;

  if (blur > 0) {
    srcCtx.filter = `blur(${blur}px)`;
  }
  srcCtx.drawImage(img, pad, pad, srcW, srcH);
  srcCtx.filter = "none";

  // Downsample the blurred image to output grid
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, pad, pad, srcW, srcH, 0, 0, outW, outH);

  const imageData = ctx.getImageData(0, 0, outW, outH);
  const pixels = imageData.data;

  const sampledW = Math.ceil(outW / scale);
  const sampledH = Math.ceil(outH / scale);
  const grayscale = new Uint8Array(sampledW * sampledH);
  const colors = new Uint8Array(sampledW * sampledH * 3);
  const alpha = new Uint8Array(sampledW * sampledH);

  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let sy = 0; sy < sampledH; sy++) {
    for (let sx = 0; sx < sampledW; sx++) {
      const px = Math.min(Math.round(sx * scale), outW - 1);
      const py = Math.min(Math.round(sy * scale), outH - 1);
      const idx = (py * outW + px) * 4;

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const blurredAlpha = pixels[idx + 3] / 255;

      alpha[sy * sampledW + sx] = alphaData[idx + 3];

      // Un-premultiply the blurred RGB so edge pixels retain their true color.
      // The separate alpha mask handles transparency cutoff in the dither step.
      let luma: number;
      let ur: number, ug: number, ub: number;
      if (blurredAlpha > 0.01) {
        ur = Math.min(255, Math.round(r / blurredAlpha));
        ug = Math.min(255, Math.round(g / blurredAlpha));
        ub = Math.min(255, Math.round(b / blurredAlpha));
        luma = 0.299 * ur + 0.587 * ug + 0.114 * ub;
      } else {
        ur = ug = ub = 0;
        luma = 0;
      }
      const colorIdx = (sy * sampledW + sx) * 3;
      colors[colorIdx] = ur;
      colors[colorIdx + 1] = ug;
      colors[colorIdx + 2] = ub;

      if (contrast !== 0) {
        luma = contrastFactor * (luma - 128) + 128;
      }

      if (gamma !== 1.0) {
        luma = 255 * Math.pow(Math.max(0, luma / 255), 1 / gamma);
      }

      if (highlightsCompression > 0) {
        const norm = luma / 255;
        const compressed = norm < 0.5
          ? norm
          : 0.5 + (norm - 0.5) * (1 - highlightsCompression);
        luma = compressed * 255;
      }

      grayscale[sy * sampledW + sx] = Math.max(0, Math.min(255, Math.round(luma)));
    }
  }

  return { grayscale, colors, alpha, width: sampledW, height: sampledH };
}

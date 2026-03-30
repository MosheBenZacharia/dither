"use client";

import { useRef, useCallback, useState } from "react";
import ParticleCanvas from "@/components/particle-canvas";

export default function Home() {
  const [imageSrc, setImageSrc] = useState("/propic.png");
  const inputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  const handleUpload = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(file);
      blobUrlRef.current = url;
      setImageSrc(url);
    }
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden">
      <ParticleCanvas
        imageSrc={imageSrc}
        onUploadRequest={handleUpload}
        onLogoPresetChange={setImageSrc}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />
      <span className="absolute bottom-3 left-3 text-[11px] text-black/15 pointer-events-none select-none">
        Dither Playground
      </span>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";

/**
 * Hero demo video. The poster carries a play-button graphic, so a click
 * anywhere on the thumbnail must start playback. Until the first play a
 * transparent button covers the whole frame and calls play() from the
 * user's gesture; after that the native controls take over.
 */
export function DemoVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  return (
    <div className="relative">
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls
        playsInline
        preload="none"
        onPlay={() => setStarted(true)}
        className="w-full h-auto block"
      />
      {!started && (
        <button
          type="button"
          aria-label="Play the FlatClaw demo"
          className="absolute inset-0 cursor-pointer bg-transparent border-0 p-0"
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            setStarted(true);
            void v.play();
          }}
        />
      )}
    </div>
  );
}

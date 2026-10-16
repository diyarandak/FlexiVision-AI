import { useEffect, useState, type RefObject } from 'react';
import type { MotionMap, PoseFrame } from '@flexivision/contracts';
import { Skeleton } from './MotionResults.tsx';
import { watchVideoPreview } from '../adapters/videoPreview.ts';

/** Playback updates stay here: graphs, collection and template forms do not render on every frame. */
export function ReferenceVideoPreview({ url, videoRef, map, progressFrame, busy, active, previewEndMs, onDuration, onFailure }: {
  url: string; videoRef: RefObject<HTMLVideoElement | null>; map: MotionMap | null;
  progressFrame: PoseFrame | undefined; busy: boolean; active: boolean;
  previewEndMs: RefObject<number | null>;
  onDuration: (duration: number | null) => void; onFailure: (message: string) => void;
}) {
  const [dimensions, setDimensions] = useState({ width: 16, height: 9 });
  const [position, setPosition] = useState({ timeMs: 0, seeking: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!busy && !map)) return;
    return watchVideoPreview(video, (timeMs, seeking) => {
      // The extracted pose stream has 10 samples/second; rendering at display
      // refresh rate adds no observations. Boundary stopping still uses raw time.
      const sampleTime = Math.round(timeMs / 100) * 100;
      setPosition(previous => previous.timeMs === sampleTime && previous.seeking === seeking
        ? previous : { timeMs: sampleTime, seeking });
      const end = previewEndMs.current;
      if (!seeking && !video.paused && end !== null && timeMs >= end) {
        previewEndMs.current = null; video.pause(); video.currentTime = end / 1000;
      }
    });
  }, [url, videoRef, previewEndMs, map, busy]);
  useEffect(() => {
    const video = videoRef.current;
    if (!active) video?.pause();
  }, [active, videoRef]);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false); setLoadError(true); onDuration(null);
      onFailure('Video bilgileri okunamadı. Yeniden açmayı veya farklı bir MP4 dosyası seçmeyi dene.');
    }, 15000);
    return () => clearTimeout(timer);
  }, [loading, attempt, onDuration, onFailure]);
  const candidate = !position.seeking ? busy ? progressFrame
    : map?.sequence.frames[Math.min(map.sequence.frames.length - 1, Math.round(position.timeMs / 100))] : undefined;
  const frame = candidate && Math.abs(candidate.timestampMs - position.timeMs) <= (busy ? 40 : 150) ? candidate : undefined;
  return <>
    <div className="video-stage" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}`,
      maxWidth: `${65 * dimensions.width / dimensions.height}vh`, marginInline: 'auto' }}>
      <video ref={videoRef} controls={!busy} playsInline preload="metadata" src={url}
        onLoadedMetadata={event => {
          if (loadError) return; // A timed-out preview requires an explicit retry.
          const video = event.currentTarget;
          if (!Number.isFinite(video.duration) || video.videoWidth <= 0 || video.videoHeight <= 0) {
            setLoading(false); setLoadError(true); onDuration(null);
            onFailure('Video bilgileri geçersiz. Başka bir MP4, WebM veya MOV dosyası dene.'); return;
          }
          setLoading(false); setLoadError(false); onDuration(video.duration);
          setDimensions({ width: video.videoWidth, height: video.videoHeight });
        }}
        onPause={() => { previewEndMs.current = null; }}
        onSeeking={event => {
          if (previewEndMs.current !== null && event.currentTarget.currentTime * 1000 > previewEndMs.current) previewEndMs.current = null;
        }}
        onError={() => { setLoading(false); setLoadError(true); onDuration(null); onFailure('Tarayıcı bu videoyu açamadı. Başka bir dosya dene.'); }} />
      <Skeleton frame={frame} width={dimensions.width} height={dimensions.height} />
    </div>
    {loading && <p role="status">Video hazırlanıyor…</p>}
    {loadError && <button className="secondary-button" onClick={() => {
      setLoadError(false); setLoading(true); setAttempt(value => value + 1); onFailure(''); videoRef.current?.load();
    }}>Videoyu yeniden aç</button>}
  </>;
}

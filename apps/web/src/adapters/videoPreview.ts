type PreviewVideo = Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'seeking' | 'addEventListener' | 'removeEventListener'>;
export interface PreviewClock {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

/** No polling while paused. Seeking still publishes so an old skeleton is hidden. */
export function watchVideoPreview(video: PreviewVideo, update: (timeMs: number, seeking: boolean) => void,
  clock: PreviewClock = { request: requestAnimationFrame, cancel: cancelAnimationFrame }): () => void {
  let pending: number | null = null, disposed = false;
  const cancel = () => { if (pending !== null) clock.cancel(pending); pending = null; };
  const tick = () => {
    pending = null;
    if (disposed) return;
    update(video.currentTime * 1000, video.seeking);
    if (!disposed && !video.paused && !video.seeking) pending = clock.request(tick);
  };
  const refresh = () => { cancel(); tick(); };
  const events = ['play', 'pause', 'ended', 'seeking', 'seeked', 'timeupdate'] as const;
  events.forEach(event => video.addEventListener(event, refresh));
  refresh();
  return () => { disposed = true; cancel(); events.forEach(event => video.removeEventListener(event, refresh)); };
}

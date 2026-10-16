import type { CalibrationProfile, FeedbackCue, LivePhaseMatch, LiveSessionSummary, LiveSetupUpdate, PoseFrame, SessionRecord, SquatSessionRecord, SquatTemplate } from '@flexivision/contracts';
import { type LivePoseSource, type LiveSessionUpdate, type SessionHistoryRepository, type SpeechOutput,
  PrepareLiveSessionSource, TrackLiveSquatSession } from '@flexivision/application';
import { LIVE_SETUP_MESSAGES, sessionSummaryData } from '@flexivision/core';

export interface MobileSessionState {
  active: boolean;
  isFinished: boolean;
  repetitionCount: number;
  currentMatch: LivePhaseMatch | null;
  lastCue: FeedbackCue | null;
  guidanceText: string;
  hasWarning: boolean;
  currentFrame?: PoseFrame;
  setup: LiveSetupUpdate | null;
  summary: LiveSessionSummary | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'failed';
  saveError: string | null;
  error: string | null;
}
export const INITIAL_MOBILE_SESSION_STATE: MobileSessionState = {
  active: false, isFinished: false, repetitionCount: 0, currentMatch: null, lastCue: null,
  guidanceText: 'Kamera karşısında ayakta rahat dur; kadraj hazır olunca geri sayım başlayacak.',
  hasWarning: false, setup: null, summary: null, saveStatus: 'idle', saveError: null, error: null,
};
export interface MobileSessionOptions {
  bodyProfile?: CalibrationProfile;
  history?: SessionHistoryRepository;
  /** Same monotonic clock as CameraPoseObservation.frame.timestampMs. */
  now?: () => number;
}
interface Archive { summary: LiveSessionSummary; endReason: SessionRecord['endReason']; record: SquatSessionRecord | null; pending: Promise<SquatSessionRecord | null> | null }

/** Platform controller only; Expo screens, AppState and native pose driver must
 * still be wired by the host app. Setup frames never enter the exercise report. */
export class MobileSquatSessionController {
  private session: TrackLiveSquatSession | null = null;
  private state: MobileSessionState = { ...INITIAL_MOBILE_SESSION_STATE };
  private generation = 0;
  private sourceUsed = false;
  private archive: Archive | null = null;

  constructor(private readonly template: SquatTemplate,
    private readonly source: LivePoseSource | (() => LivePoseSource), private readonly speech?: SpeechOutput,
    private readonly onStateChange?: (state: MobileSessionState) => void, private readonly startTimeMs = 0,
    private readonly options: MobileSessionOptions = {}) {}

  getState(): MobileSessionState {
    return { ...this.state, setup: this.state.setup ? { ...this.state.setup } : null,
      summary: this.state.summary ? sessionSummaryData(this.state.summary) : null };
  }
  async start(): Promise<void> {
    if (this.state.active) return;
    if (this.archive && this.options.history && !this.archive.record) {
      this.state.error = 'Önce önceki raporu kaydet veya açıkça kaydetmeden kapat.'; this.emitChange(); return;
    }
    const current = ++this.generation;
    this.state = { ...INITIAL_MOBILE_SESSION_STATE, active: true }; this.archive = null; this.emitChange();
    if (current !== this.generation) return;
    try {
      if (typeof this.source !== 'function' && this.sourceUsed) throw new Error('Yeniden başlatmak için yeni kamera kaynağı sağlayan bir factory gerekir.');
      const source = typeof this.source === 'function' ? this.source() : this.source;
      this.sourceUsed = true;
      const prepared = new PrepareLiveSessionSource(source, this.template.repetition.side, (observation, setup) => {
        if (current !== this.generation) return;
        this.state.setup = setup;
        this.state.guidanceText = setup.countdown === null ? LIVE_SETUP_MESSAGES[setup.guide] : `${setup.countdown} · ${LIVE_SETUP_MESSAGES.countdown}`;
        if (observation) this.state.currentFrame = observation.frame; else delete this.state.currentFrame;
        this.emitChange();
      });
      try {
        this.session = new TrackLiveSquatSession(prepared, this.template, this.speech, this.startTimeMs, this.options.bodyProfile);
      } catch (error) { prepared.stop(); throw error; }
      await this.session.start(update => {
        if (current !== this.generation) return;
        this.update(update); this.emitChange();
      }, error => {
        if (current !== this.generation) return;
        this.freeze('interrupted'); this.state.error = error.message; this.emitChange();
        void this.saveArchive().catch(() => undefined);
      });
    } catch (error) {
      if (current !== this.generation) return;
      this.freeze('interrupted'); this.state.error = error instanceof Error ? error.message : 'Kamera başlatılamadı.'; this.emitChange();
      void this.saveArchive().catch(() => undefined);
    }
  }
  private update(update: LiveSessionUpdate) {
    const comp = update.comparison;
    this.state.repetitionCount = comp.repetitionCount;
    this.state.currentMatch = comp.observation.status === 'unknown' ? null : comp.match;
    this.state.lastCue = update.cue;
    if (comp.observation.status === 'unknown') delete this.state.currentFrame;
    else this.state.currentFrame = update.observation.frame;
    this.state.hasWarning = comp.observation.status === 'incorrect';
    this.state.guidanceText = comp.observation.status === 'unknown' ? 'Ölçüm belirsiz · Kadrajı ve kamera hızını kontrol et.'
      : comp.observation.status === 'incorrect' ? comp.observation.errors[0]?.message ?? 'Referanstan sapma gözlendi.'
      : 'İzlenen açılar referans aralığında.';
  }
  private freeze(endReason: SessionRecord['endReason'], atMs?: number): LiveSessionSummary | null {
    if (!this.archive && this.session) {
      const summary = this.session.getSummary(atMs ?? this.options.now?.());
      if (summary.sampledFrames > 0) this.archive = { summary, endReason, record: null, pending: null };
    }
    ++this.generation; this.session?.stop(); this.session = null; this.speech?.cancel();
    this.state.active = false; this.state.isFinished = !!this.archive; this.state.setup = null;
    this.state.currentMatch = null; this.state.lastCue = null; this.state.hasWarning = false; delete this.state.currentFrame;
    this.state.summary = this.archive ? sessionSummaryData(this.archive.summary) : null;
    return this.state.summary;
  }
  finish(atMs?: number): LiveSessionSummary | null {
    const summary = this.freeze('finished', atMs); this.emitChange(); return summary;
  }
  async finishAndSave(atMs?: number): Promise<SquatSessionRecord | null> {
    this.finish(atMs); return this.saveArchive();
  }
  /** Native AppState/background and close handlers should call and await this. */
  async interrupt(atMs?: number): Promise<SquatSessionRecord | null> {
    this.freeze('interrupted', atMs); this.emitChange(); return this.saveArchive();
  }
  stop(): void {
    this.freeze('interrupted'); this.emitChange(); void this.saveArchive().catch(() => undefined);
  }
  retrySave(): Promise<SquatSessionRecord | null> { return this.saveArchive(); }
  discardUnsavedReport(): void {
    if (this.state.active || this.archive?.pending) return;
    this.archive = null; this.state = { ...INITIAL_MOBILE_SESSION_STATE }; this.emitChange();
  }
  private saveArchive(): Promise<SquatSessionRecord | null> {
    const archive = this.archive, history = this.options.history;
    if (!archive || !history) return Promise.resolve(null);
    if (archive.record) return Promise.resolve(archive.record);
    if (archive.pending) return archive.pending;
    this.state.saveStatus = 'saving'; this.state.saveError = null;
    archive.pending = Promise.resolve().then(() => history.save(sessionSummaryData(archive.summary),
      { repetitionId: this.template.repetition.id, side: this.template.repetition.side }, archive.endReason))
      .then(record => { archive.record = record; if (this.archive === archive) { this.state.saveStatus = 'saved'; this.state.saveError = null; this.emitChange(); } return record; })
      .catch(error => { if (this.archive === archive) { this.state.saveStatus = 'failed'; this.state.saveError = 'Rapor kaydedilemedi. Tekrar dene veya kaydetmeden kapat.'; this.emitChange(); } throw error; })
      .finally(() => { archive.pending = null; });
    this.emitChange();
    return archive.pending;
  }
  private emitChange() { this.onStateChange?.(this.getState()); }
}

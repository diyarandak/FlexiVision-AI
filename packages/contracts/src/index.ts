/** Shared serializable values. Never expose DOM, React Native or vendor SDK types. */
export type RejectionCode =
  | 'invalid_evidence'
  | 'duration_out_of_range'
  | 'insufficient_frames'
  | 'multiple_people'
  | 'body_not_visible'
  | 'unsupported_view'
  | 'unsupported_motion'
  | 'incomplete_repetition';

export type ReferenceDecision =
  | { status: 'accepted'; policyVersion: 'reference-v1' }
  | { status: 'rejected'; policyVersion: 'reference-v1'; reasons: RejectionCode[] };

/** An analyser failure is not a negative decision about the exercise. */
export type AnalysisResult =
  | { status: 'completed'; decision: ReferenceDecision }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export interface ReferenceEvidence {
  durationMs: number;
  sampledFrames: number;
  usableFrames: number;
  multiPersonFrames: number;
  view: 'supported' | 'unsupported' | 'unknown';
  motion: 'supported' | 'unsupported' | 'unknown';
  completeRepetitions: number;
}

/** Values come from the motion comparer, not directly from an LLM. */
export interface FormError {
  code: string;
  message: string;
  severity: number;
}

export type FormObservation =
  | { status: 'correct' }
  | { status: 'unknown'; reason: string }
  | { status: 'incorrect'; errors: readonly FormError[] };

export interface FeedbackCue {
  code: string;
  text: string;
  atMs: number;
}

export interface Capabilities {
  contractVersion: 1;
  referenceAnalysis: 'unavailable';
  liveComparison: 'unavailable';
  rawVideoUpload: false;
  feedbackIntervalMs: 10000;
}

export interface PosePoint { x: number; y: number; z: number; visibility: number }
export interface PersonPose {
  landmarks: PosePoint[];
  worldLandmarks: PosePoint[];
}
export interface PoseFrame { timestampMs: number; people: PersonPose[] }
export interface PoseSequence {
  schemaVersion: 1;
  engine: { name: 'mediapipe-pose'; version: string; model: string };
  durationMs: number;
  width: number;
  height: number;
  sampleFps: number;
  frames: PoseFrame[];
}
export type JointName = 'leftKnee' | 'rightKnee' | 'leftHip' | 'rightHip' | 'leftElbow' | 'rightElbow';
export type JointAngles = Record<JointName, number | null>;
export interface MotionSample {
  timestampMs: number;
  angles2d: JointAngles;
}
/** Measured draft data only. Does not certify a movement or authorize a session. */
export interface MotionMap {
  schemaVersion: 1;
  kind: 'reference-motion-map';
  qualification: 'not_evaluated' | 'accepted' | 'rejected';
  decision?: ReferenceDecision;
  evidence?: ReferenceEvidence;
  staticAnalysis?: StaticPoseAnalysis;
  status: 'extracted' | 'insufficient_data';
  sequence: PoseSequence;
  samples: MotionSample[];
  quality: { sampledFrames: number; singlePersonFrames: number; usableFrames: number; multiPersonFrames: number; usableRatio: number };
  ranges: Record<JointName, { min: number; max: number } | null>;
}
export interface AnalysisProgress {
  stage: 'loading_model' | 'extracting';
  completed: number;
  total: number;
  frame?: PoseFrame;
}

export type BodySide = 'left' | 'right';
export type SquatPhase = 'descent' | 'bottom' | 'ascent';
export interface PhaseInterval { phase: SquatPhase; startMs: number; endMs: number }
export interface SquatRepetition {
  id: number;
  side: BodySide;
  startMs: number;
  endMs: number;
  bottomMs: number;
  phases: PhaseInterval[];
  kneeRange: { min: number; max: number };
  hipRange: { min: number; max: number };
}
/** A cycle under a squat preset; does not classify an arbitrary exercise or camera view. */
export interface SquatCycleAnalysis {
  policyVersion: 'squat-cycles-v1';
  status: 'ready' | 'insufficient_data' | 'no_complete_repetition';
  side: BodySide | null;
  repetitions: SquatRepetition[];
  reason: 'body_not_visible' | 'no_consistent_side' | 'no_complete_repetition' | null;
  trackingBreaks: number;
  /** Measured explanation only; never authorizes or reconstructs a missing cycle. */
  incompleteCause?: 'missing_standing_start' | 'missing_standing_end' | 'missing_standing_start_and_end' | 'tracking_gap';
}
export interface SquatTemplate {
  schemaVersion: 1;
  kind: 'squat-cycle-template';
  qualification: 'not_evaluated' | 'accepted';
  decision?: ReferenceDecision;
  policyVersion: 'squat-cycles-v1';
  source: { engine: PoseSequence['engine']; durationMs: number; width: number; height: number };
  repetition: SquatRepetition;
  durationMs: number;
  /** Progress is time within this single reference repetition, from 0 to 1. */
  samples: { progress: number; offsetMs: number; phase: SquatPhase; angles2d: JointAngles }[];
}
/** A measured repeating 2D motion. It does not name an exercise or certify safe form. */
export type GenericPhase = 'outbound' | 'return';
export interface GenericRepetition {
  id: number;
  startMs: number;
  turnMs: number;
  endMs: number;
  /** Maximum pelvis-centred, torso-scaled displacement of tracked moving points. */
  movementScore: number;
}
export interface GenericCycleAnalysis {
  policyVersion: 'generic-cycles-v1';
  status: 'ready' | 'insufficient_data' | 'no_complete_repetition';
  trackedIndices: number[];
  motionIndices: number[];
  repetitions: GenericRepetition[];
  trackingBreaks: number;
  reason: 'body_not_visible' | 'insufficient_tracked_landmarks' | 'unstable_view' | 'no_repeated_motion' | 'tracking_gap' | null;
}
export interface GenericMotionTemplate {
  schemaVersion: 1;
  kind: 'generic-cycle-template';
  qualification: 'not_evaluated' | 'accepted';
  decision?: ReferenceDecision;
  policyVersion: 'generic-cycles-v1';
  source: { engine: PoseSequence['engine']; durationMs: number; width: number; height: number };
  /** Only visible and measurable indices are selected; the 33-point array retains null gaps. */
  trackedIndices: number[];
  motionIndices: number[];
  /** Median shoulder/hip width in reference torso units, for live view consistency checks. */
  projection: { shoulderWidth: number; hipWidth: number };
  repetition: GenericRepetition;
  durationMs: number;
  samples: {
    progress: number;
    offsetMs: number;
    phase: GenericPhase;
    angles2d: JointAngles;
    /** Pelvis-centred, torso-scaled, aspect-corrected image positions. */
    landmarks: ({ x: number; y: number } | null)[];
  }[];
}
export interface SavedReferenceTemplate {
  schemaVersion: 1;
  id: string;
  name: string;
  savedAt: string;
  template: ExerciseTemplate;
}

export interface CameraPoseObservation {
  frame: PoseFrame;
  width: number;
  height: number;
  /** Capture/analysis duration; lets a slow device differ from a missing observation. */
  processingMs?: number;
}
export type CalibrationStage = 'front' | 'complete';
export type CalibrationGuide = 'no_person' | 'multiple_people' | 'show_shoulders' | 'show_hips'
  | 'show_knees' | 'show_ankles' | 'step_back' | 'step_closer' | 'center_body'
  | 'face_camera' | 'stand_straight' | 'hold_still' | 'ready';
/** Image projection cue, not a measured camera yaw or exercise qualification. */
export interface CalibrationTarget {
  side: BodySide;
  shoulderRatio: number;
  hipRatio: number;
}
export interface CalibrationProfile {
  schemaVersion: 2;
  kind: 'body-calibration';
  qualification: 'not_evaluated';
  policyVersion: 'body-scan-v2';
  width: number;
  height: number;
  /** Projected relative lengths, not physical body measurements. */
  proportions: { shoulderWidth: number; hipWidth: number; leftThigh: number; rightThigh: number; leftShin: number; rightShin: number };
  neutralAngles: JointAngles;
  origin: { x: number; y: number };
  torsoPixels: number;
}
export interface SavedBodyProfile {
  schemaVersion: 1;
  savedAt: string;
  profile: CalibrationProfile;
}
export interface CalibrationUpdate {
  stage: CalibrationStage;
  guide: CalibrationGuide;
  /** Stable observation progress, not model accuracy. */
  progress: number;
  profile: CalibrationProfile | null;
}
export interface NormalizedBodyPose {
  origin: { x: number; y: number };
  torsoPixels: number;
  /** Pelvis-centred image coordinates in torso-length units; z is not mixed in. */
  landmarks: ({ x: number; y: number } | null)[];
}
export interface PersonalBodyPose {
  origin: { x: number; y: number };
  /** Current torso scale times the saved projected leg/torso ratio; not centimetres. */
  legUnitPixels: number;
  landmarks: ({ x: number; y: number } | null)[];
}

export type LiveSetupGuide = 'find_person' | 'multiple_people' | 'show_shoulders' | 'show_hips' | 'show_knees' | 'show_ankles'
  | 'step_back' | 'step_closer' | 'turn_sideways' | 'stand_still' | 'processing_slow' | 'stream_slow' | 'stream_waiting' | 'hold' | 'countdown' | 'start';
export interface LiveSetupUpdate {
  stage: 'positioning' | 'countdown' | 'active';
  guide: LiveSetupGuide;
  progress: number;
  countdown: number | null;
}

export type LiveMovementPhase = 'standing' | 'descent' | 'bottom' | 'ascent';

export interface LivePhaseMatch {
  phase: LiveMovementPhase;
  /** Estimated progress within current repetition: 0 to 1 */
  progress: number;
  /** Index into the reference template's 51 samples (0 to 50) */
  templateIndex: number;
  /** Expected angles from the template at this phase */
  targetAngles: JointAngles;
  /** Measured live angles */
  liveAngles: JointAngles;
  /** Absolute deviation in degrees for key joints */
  deviations: {
    knee: number | null;
    hip: number | null;
  };
}

export interface LiveComparisonResult {
  timestampMs: number;
  observation: FormObservation;
  match: LivePhaseMatch | null;
  repetitionCount: number;
  bodyPose?: PersonalBodyPose | null;
}

export interface LiveSessionSummary {
  durationMs: number;
  repetitionCount: number;
  sampledFrames: number;
  trackedFrames: number;
  lostFrames: number;
  cleanRepetitions: number;
  spokenCues: { code: string; text: string; atMs: number }[];
  cueCandidatesCount: number;
  errorBreakdown: Record<string, number>;
  trackedMs: number;
  unmeasuredMs: number;
  bodyProfileUsed: boolean;
  deviations: {
    knee: { samples: number; mean: number | null; max: number | null };
    hip: { samples: number; mean: number | null; max: number | null };
  };
}

export type SessionEndReason = 'finished' | 'interrupted';
/** Bounded diagnostic vocabulary; no camera images, joint positions or free-form messages. */
export const GENERIC_UNKNOWN_REASONS = ['no_person', 'multiple_people', 'body_not_visible', 'camera_view',
  'tracking_lost', 'find_start', 'hold_start', 'processing_slow', 'cycle_timeout', 'motion_too_fast',
  'pose_uncertain', 'cycle_too_short', 'other'] as const;
export type GenericUnknownReason = typeof GENERIC_UNKNOWN_REASONS[number];
export type GenericCorrectionAction = 'bend' | 'extend' | 'raise' | 'lower' | 'align';
export interface GenericCorrectionFinding {
  jointIndex: number;
  action: GenericCorrectionAction;
  phase: 'outbound' | 'return';
  frames: number;
  longestMs: number;
  spokenCount: number;
}
export interface GenericSessionDiagnostics {
  schemaVersion: 1;
  /** First processed camera observation to the requested end, including setup. */
  elapsedMs: number;
  measuredStart: boolean;
  timeToStartMs: number | null;
  /** Frame comparisons, not an exercise safety score or a count of spoken warnings. */
  correctFrames: number;
  incorrectFrames: number;
  unknownReasons: Partial<Record<GenericUnknownReason, number>>;
  errorCodes: Partial<Record<'motion_path', number>>;
  /** Keys are landmark indices 0–32; values count frames, never coordinates. */
  deviatingJointFrames: Partial<Record<number, number>>;
  /** Required torso/tracked joints missing in single-pose frames only. */
  missingJointFrames: Partial<Record<number, number>>;
  poseCandidates: { none: number; single: number; multiple: number };
  processing: { samples: number; meanMs: number | null; maxMs: number | null };
  /** Optional in older records; counts only frames after a measured starting pose. */
  postStartUnknownReasons?: Partial<Record<GenericUnknownReason, number>>;
  postStartPhaseFrames?: { waiting: number; outbound: number; return: number };
  /** Unknown frames that interrupted an active outbound or return phase. */
  cycleInterruptions?: number;
  /** Bounded aggregated observations; no coordinates, recordings or free-form text. */
  corrections?: GenericCorrectionFinding[];
}
export interface RepetitionGoal {
  sets: number;
  repetitionsPerSet: number;
}
export interface GenericSessionSummary {
  /** Time since a measured start pose; setup time is excluded. */
  durationMs: number;
  repetitionCount: number;
  sampledFrames: number;
  trackedFrames: number;
  unmeasuredFrames: number;
  cueCandidatesCount: number;
  spokenCuesCount: number;
  bodyProfileUsed: boolean;
  /** Optional for backwards-compatible history. Invalid optional data is discarded when read. */
  diagnostics?: GenericSessionDiagnostics;
  /** Optional for older sessions; completed sets are derived from measured repetitions. */
  repetitionGoal?: RepetitionGoal;
}
export interface SquatSessionRecord {
  schemaVersion: 1;
  id: string;
  savedAt: string;
  exercise: 'squat';
  reference: { repetitionId: number; side: BodySide };
  endReason: SessionEndReason;
  summary: LiveSessionSummary;
}
/** Aggregate-only report; it never contains video, landmarks, or a body profile. */
export interface GenericSessionRecord {
  schemaVersion: 2;
  id: string;
  savedAt: string;
  exercise: 'generic-cycle';
  reference: { repetitionId: number; policyVersion: 'generic-cycles-v1' };
  endReason: SessionEndReason;
  summary: GenericSessionSummary;
}
export type SessionRecord = SquatSessionRecord | GenericSessionRecord | StaticSessionRecord;
export interface StaticPoseTemplate {
  schemaVersion: 1; kind: 'static-pose-template'; qualification: 'accepted'; policyVersion: 'static-pose-v1';
  source: { engine: PoseSequence['engine']; width: number; height: number; durationMs: number };
  interval: { id:number; startMs:number; endMs:number }; durationMs:number;
  landmarks: ({x:number;y:number}|null)[];
}
export type ExerciseTemplate = SquatTemplate | GenericMotionTemplate | StaticPoseTemplate;
export interface StaticPoseAnalysis { decision:ReferenceDecision; evidence:ReferenceEvidence; holds:StaticPoseTemplate[] }
export interface StaticSessionSummary {
  durationMs:number; matchedMs:number; targetMs:number; targetReached:boolean;
  sampledFrames:number; trackedFrames:number; unmeasuredFrames:number; cueCandidatesCount:number; spokenCuesCount:number;
}
export interface StaticSessionRecord {
  schemaVersion:3; id:string; savedAt:string; exercise:'static-pose';
  reference:{ intervalId:number; policyVersion:'static-pose-v1' }; endReason:SessionEndReason; summary:StaticSessionSummary;
}

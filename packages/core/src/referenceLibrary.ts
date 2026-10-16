import { isAcceptedStaticTemplate, staticTemplateData } from './staticPose.ts';
import type { ExerciseTemplate } from '@flexivision/contracts';
import type { GenericMotionTemplate, JointAngles, SavedReferenceTemplate, SquatTemplate } from '@flexivision/contracts';

export const MAX_SAVED_REFERENCES = 20;
export const MAX_REFERENCE_SERIALIZED_LENGTH = 1000000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const jointNames = ['leftKnee', 'rightKnee', 'leftHip', 'rightHip', 'leftElbow', 'rightElbow'] as const;
export const validReferenceName = (v: unknown): v is string => typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= 80 && !/[\u0000-\u001f\u007f]/.test(v);

/** Structural validation of a locally produced accepted template. This is not
 * a second video analysis or proof of authenticity for arbitrary imported JSON. */
export function isAcceptedSquatTemplate(value: unknown): value is SquatTemplate {
  if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'squat-cycle-template'
    || value.policyVersion !== 'squat-cycles-v1' || value.qualification !== 'accepted'
    || !object(value.decision) || value.decision.status !== 'accepted' || value.decision.policyVersion !== 'reference-v1'
    || !object(value.source) || !object(value.source.engine) || !object(value.repetition)) return false;
  const source = value.source, engine = source.engine as Record<string, unknown>, rep = value.repetition;
  if (!number(source.width, 1, 10000) || !number(source.height, 1, 10000) || !number(source.durationMs, 3000, 60000)
    || engine.name !== 'mediapipe-pose' || !['version', 'model'].every(key => typeof engine[key] === 'string' && (engine[key] as string).length > 0 && (engine[key] as string).length <= 150)) return false;
  if (!number(rep.id, 1, 1000) || !Number.isInteger(rep.id) || !['left', 'right'].includes(rep.side as string)
    || !number(rep.startMs, 0, source.durationMs) || !number(rep.endMs, rep.startMs, source.durationMs)
    || !number(value.durationMs, 1000, 12000) || Math.abs(rep.endMs - rep.startMs - value.durationMs) > 1e-6
    || !number(rep.bottomMs, rep.startMs, rep.endMs) || !Array.isArray(rep.phases) || rep.phases.length !== 3) return false;
  for (const key of ['kneeRange', 'hipRange']) {
    const range = rep[key];
    if (!object(range) || !number(range.min, 0, 180) || !number(range.max, range.min, 180)) return false;
  }
  let previous = rep.startMs;
  const phases = ['descent', 'bottom', 'ascent'];
  for (let i = 0; i < 3; i++) {
    const phase: unknown = rep.phases[i];
    if (!object(phase) || phase.phase !== phases[i] || !number(phase.startMs, rep.startMs, rep.endMs)
      || Math.abs(phase.startMs - previous) > 1e-6 || !number(phase.endMs, phase.startMs, rep.endMs) || phase.endMs === phase.startMs) return false;
    previous = phase.endMs;
    if (i === 1 && (rep.bottomMs < phase.startMs || rep.bottomMs > phase.endMs)) return false;
  }
  if (Math.abs(previous - rep.endMs) > 1e-6 || !Array.isArray(value.samples) || value.samples.length !== 51) return false;
  const knee = `${rep.side}Knee`, hip = `${rep.side}Hip`;
  for (let i = 0; i < 51; i++) {
    const sample: unknown = value.samples[i];
    if (!object(sample) || !number(sample.progress, 0, 1) || Math.abs(sample.progress - i / 50) > 1e-9
      || !number(sample.offsetMs, 0, value.durationMs) || Math.abs(sample.offsetMs - sample.progress * value.durationMs) > 1e-6
      || !object(sample.angles2d) || !jointNames.every(key => sample.angles2d && ((sample.angles2d as Record<string, unknown>)[key] === null
        || number((sample.angles2d as Record<string, unknown>)[key], 0, 180)))
      || !number(sample.angles2d[knee], 0, 180) || !number(sample.angles2d[hip], 0, 180)) return false;
    const atMs = rep.startMs + sample.offsetMs;
    const expected = rep.phases.find(p => object(p) && atMs < (p.endMs as number))?.phase ?? 'ascent';
    if (sample.phase !== expected) return false;
  }
  return true;
}

/** Check the measured generic trajectory before storing it. This does not
 * authenticate an external JSON file or reevaluate the source video. */
export function isAcceptedGenericTemplate(value: unknown): value is GenericMotionTemplate {
  if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'generic-cycle-template'
    || value.policyVersion !== 'generic-cycles-v1' || value.qualification !== 'accepted'
    || !object(value.decision) || value.decision.status !== 'accepted' || value.decision.policyVersion !== 'reference-v1'
    || !object(value.source) || !object(value.source.engine) || !object(value.repetition)
    || !object(value.projection)) return false;
  const source = value.source, engine = source.engine as Record<string, unknown>, rep = value.repetition;
  if (!number(source.width, 1, 10000) || !number(source.height, 1, 10000) || !number(source.durationMs, 3000, 60000)
    || engine.name !== 'mediapipe-pose' || !['version', 'model'].every(key => typeof engine[key] === 'string'
      && (engine[key] as string).length > 0 && (engine[key] as string).length <= 150)
    || !number(value.projection.shoulderWidth, 0, 10) || !number(value.projection.hipWidth, 0, 10)) return false;
  const allowed = new Set([13, 14, 15, 16, 25, 26, 27, 28]);
  const validIndices = (list: unknown, min: number, max: number): list is number[] => Array.isArray(list)
    && list.length >= min && list.length <= max && list.every((index, i) => Number.isInteger(index)
      && allowed.has(index) && (i === 0 || list[i - 1] < index));
  if (!validIndices(value.trackedIndices, 4, 6) || !validIndices(value.motionIndices, 2, 4)
    || !value.motionIndices.every(index => (value.trackedIndices as number[]).includes(index))) return false;
  if (!number(rep.id, 1, 1000) || !Number.isInteger(rep.id)
    || !number(rep.startMs, 0, source.durationMs) || !number(rep.endMs, rep.startMs, source.durationMs)
    || !number(rep.turnMs, rep.startMs, rep.endMs) || rep.turnMs === rep.startMs || rep.turnMs === rep.endMs
    || !number(rep.movementScore, 0.30, 20) || !number(value.durationMs, 1000, 12000)
    || Math.abs(rep.endMs - rep.startMs - value.durationMs) > 1e-6
    || !Array.isArray(value.samples) || value.samples.length !== 51) return false;
  for (let i = 0; i < 51; i++) {
    const sample: unknown = value.samples[i];
    if (!object(sample) || !number(sample.progress, 0, 1) || Math.abs(sample.progress - i / 50) > 1e-9
      || !number(sample.offsetMs, 0, value.durationMs)
      || Math.abs(sample.offsetMs - sample.progress * value.durationMs) > 1e-6
      || !object(sample.angles2d) || !jointNames.every(key => sample.angles2d && ((sample.angles2d as Record<string, unknown>)[key] === null
        || number((sample.angles2d as Record<string, unknown>)[key], 0, 180)))
      || !Array.isArray(sample.landmarks) || sample.landmarks.length !== 33) return false;
    const atMs = rep.startMs + sample.offsetMs;
    if (sample.phase !== (atMs < rep.turnMs ? 'outbound' : 'return')) return false;
    for (let j = 0; j < 33; j++) {
      const point: unknown = sample.landmarks[j];
      if (point === null) { if (value.trackedIndices.includes(j)) return false; continue; }
      if (!object(point) || !number(point.x, -20, 20) || !number(point.y, -20, 20)) return false;
    }
  }
  return true;
}

export function isSavedReference(value: unknown): value is SavedReferenceTemplate {
  return object(value) && value.schemaVersion === 1 && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.id)
    && validReferenceName(value.name) && typeof value.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.savedAt)
    && Number.isFinite(Date.parse(value.savedAt))
    && (isAcceptedSquatTemplate(value.template) || isAcceptedGenericTemplate(value.template) || isAcceptedStaticTemplate(value.template));
}
/** Whitelist numeric template fields. Video, frames, profiles and attached data are not persisted. */
export function referenceTemplateData(template: ExerciseTemplate): ExerciseTemplate {
  if (template.kind === 'static-pose-template') return staticTemplateData(template);
  if (template.kind === 'generic-cycle-template') {
    if (!isAcceptedGenericTemplate(template)) throw new Error('Yalnızca geçerli, kabul edilmiş bir hareket şablonu kaydedilebilir.');
    const rep = template.repetition;
    return { schemaVersion: 1, kind: 'generic-cycle-template', qualification: 'accepted',
      decision: { status: 'accepted', policyVersion: 'reference-v1' }, policyVersion: 'generic-cycles-v1',
      source: { engine: { name: template.source.engine.name, version: template.source.engine.version, model: template.source.engine.model },
        width: template.source.width, height: template.source.height, durationMs: template.source.durationMs },
      trackedIndices: [...template.trackedIndices], motionIndices: [...template.motionIndices],
      projection: { shoulderWidth: template.projection.shoulderWidth, hipWidth: template.projection.hipWidth },
      repetition: { id: rep.id, startMs: rep.startMs, turnMs: rep.turnMs, endMs: rep.endMs, movementScore: rep.movementScore },
      durationMs: template.durationMs,
      samples: template.samples.map(sample => ({ progress: sample.progress, offsetMs: sample.offsetMs, phase: sample.phase,
        angles2d: Object.fromEntries(jointNames.map(key => [key, sample.angles2d[key]])) as JointAngles,
        landmarks: sample.landmarks.map(point => point ? { x: point.x, y: point.y } : null) })) };
  }
  if (!isAcceptedSquatTemplate(template)) throw new Error('Yalnızca geçerli, kabul edilmiş bir squat şablonu kaydedilebilir.');
  const rep = template.repetition;
  return { schemaVersion: 1, kind: 'squat-cycle-template', qualification: 'accepted', decision: { status: 'accepted', policyVersion: 'reference-v1' },
    policyVersion: 'squat-cycles-v1', source: { engine: { name: template.source.engine.name, version: template.source.engine.version, model: template.source.engine.model },
      width: template.source.width, height: template.source.height, durationMs: template.source.durationMs },
    durationMs: template.durationMs, repetition: { id: rep.id, side: rep.side, startMs: rep.startMs, endMs: rep.endMs, bottomMs: rep.bottomMs,
      phases: rep.phases.map(p => ({ phase: p.phase, startMs: p.startMs, endMs: p.endMs })),
      kneeRange: { min: rep.kneeRange.min, max: rep.kneeRange.max }, hipRange: { min: rep.hipRange.min, max: rep.hipRange.max } },
    samples: template.samples.map(s => ({ progress: s.progress, offsetMs: s.offsetMs, phase: s.phase,
      angles2d: Object.fromEntries(jointNames.map(key => [key, s.angles2d[key]])) as JointAngles })) };
}
export function savedReferenceData(record: SavedReferenceTemplate): SavedReferenceTemplate {
  if (!isSavedReference(record)) throw new Error('Egzersiz kaydı geçersiz.');
  return { schemaVersion: 1, id: record.id, name: record.name, savedAt: record.savedAt, template: referenceTemplateData(record.template) };
}
export function readReferenceLibrary(raw: string | null): SavedReferenceTemplate[] {
  if (!raw) return [];
  if (raw.length > MAX_REFERENCE_SERIALIZED_LENGTH) throw new Error('Egzersiz kitaplığı çok büyük.');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > MAX_SAVED_REFERENCES || !data.every(isSavedReference)
    || new Set(data.map(r => r.id)).size !== data.length) throw new Error('Egzersiz kitaplığı okunamadı. Kayıtlar değiştirilmedi.');
  return data.map(savedReferenceData);
}
export function writeReferenceLibrary(records: SavedReferenceTemplate[]): string {
  if (records.length > MAX_SAVED_REFERENCES) throw new Error('En fazla 20 egzersiz saklanabilir. Önce bir kaydı sil.');
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Egzersiz kimliği tekrarlandı.');
  const raw = JSON.stringify(records.map(savedReferenceData));
  if (raw.length > MAX_REFERENCE_SERIALIZED_LENGTH) throw new Error('Egzersiz kitaplığı için yeterli alan yok.');
  return raw;
}

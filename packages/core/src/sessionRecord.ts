import { genericDiagnosticsData } from './genericDiagnostics.ts';
import { isRepetitionGoal } from './repetitionGoal.ts';
import type { StaticSessionSummary, GenericSessionSummary, LiveSessionSummary, SessionRecord } from '@flexivision/contracts';

export const MAX_SESSION_RECORDS = 50;
const MAX_SESSION_SERIALIZED_LENGTH = 1000000;

const number = (v: unknown, max = 86400000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const count = (v: unknown, max = 10000000): v is number => number(v, max) && Number.isInteger(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const code = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v);

export function isSessionSummary(value: unknown): value is LiveSessionSummary {
  if (!object(value)) return false;
  const s = value;
  if (!number(s.durationMs) || !number(s.trackedMs) || !number(s.unmeasuredMs)
    || Math.abs(s.durationMs - s.trackedMs - s.unmeasuredMs) > 1e-6 || typeof s.bodyProfileUsed !== 'boolean') return false;
  if (!['repetitionCount', 'sampledFrames', 'trackedFrames', 'lostFrames', 'cleanRepetitions', 'cueCandidatesCount'].every(key => count(s[key]))) return false;
  if ((s.trackedFrames as number) + (s.lostFrames as number) !== s.sampledFrames
    || (s.cleanRepetitions as number) > (s.repetitionCount as number)) return false;
  if (!Array.isArray(s.spokenCues) || s.spokenCues.length > 10000 || s.spokenCues.length > (s.cueCandidatesCount as number)
    || !s.spokenCues.every(c => object(c) && code(c.code) && typeof c.text === 'string' && c.text.length > 0 && c.text.length <= 500 && number(c.atMs, 1e12))) return false;
  if (!object(s.errorBreakdown) || Object.keys(s.errorBreakdown).length > 32
    || !Object.entries(s.errorBreakdown).every(([key, v]) => code(key) && count(v) && v <= (s.sampledFrames as number))) return false;
  if (!object(s.deviations)) return false;
  return ['knee', 'hip'].every(key => {
    const v = (s.deviations as Record<string, unknown>)[key];
    if (!object(v) || !count(v.samples) || v.samples > (s.trackedFrames as number)) return false;
    return v.samples === 0 ? v.mean === null && v.max === null
      : number(v.mean, 180) && number(v.max, 180) && v.mean <= v.max + 0.1;
  });
}

export function isGenericSessionSummary(value: unknown): value is GenericSessionSummary {
  if (!object(value) || !number(value.durationMs) || typeof value.bodyProfileUsed !== 'boolean') return false;
  if (!['repetitionCount', 'sampledFrames', 'trackedFrames', 'unmeasuredFrames', 'cueCandidatesCount', 'spokenCuesCount']
    .every(key => count(value[key]))) return false;
  return (value.trackedFrames as number) + (value.unmeasuredFrames as number) === value.sampledFrames
    && (value.spokenCuesCount as number) <= (value.cueCandidatesCount as number)
    && (value.repetitionCount as number) <= (value.trackedFrames as number);
}

export function isStaticSessionSummary(v:unknown):v is StaticSessionSummary {
  if(!object(v)||!number(v.durationMs)||!number(v.matchedMs)||!count(v.targetMs,600000)||v.targetMs<5000
    ||v.matchedMs>v.durationMs||v.matchedMs>v.targetMs||v.targetReached!==(v.matchedMs>=v.targetMs))return false;
  return ['sampledFrames','trackedFrames','unmeasuredFrames','cueCandidatesCount','spokenCuesCount'].every(k=>count(v[k]))
    && (v.trackedFrames as number)+(v.unmeasuredFrames as number)===v.sampledFrames
    && (v.spokenCuesCount as number)<=(v.cueCandidatesCount as number);
}
export function staticSessionSummaryData(s:StaticSessionSummary):StaticSessionSummary {
  return {durationMs:s.durationMs,matchedMs:s.matchedMs,targetMs:s.targetMs,targetReached:s.targetReached,
    sampledFrames:s.sampledFrames,trackedFrames:s.trackedFrames,unmeasuredFrames:s.unmeasuredFrames,
    cueCandidatesCount:s.cueCandidatesCount,spokenCuesCount:s.spokenCuesCount};
}

export function isSessionRecord(value: unknown): value is SessionRecord {
  if (!object(value)
    || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)
    || typeof value.savedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt))
    || !['finished', 'interrupted'].includes(value.endReason as string) || !object(value.reference)) return false;
  if(value.schemaVersion===3&&value.exercise==='static-pose')return count(value.reference.intervalId,1000)&&value.reference.intervalId>0
    &&value.reference.policyVersion==='static-pose-v1'&&isStaticSessionSummary(value.summary)&&value.summary.trackedFrames>0;
  if (!count(value.reference.repetitionId, 1000) || value.reference.repetitionId < 1) return false;
  if (value.schemaVersion === 1 && value.exercise === 'squat') {
    return ['left', 'right'].includes(value.reference.side as string) && isSessionSummary(value.summary);
  }
  return value.schemaVersion === 2 && value.exercise === 'generic-cycle'
    && value.reference.policyVersion === 'generic-cycles-v1' && isGenericSessionSummary(value.summary)
    && value.summary.trackedFrames > 0;
}

/** Explicit fields only: raw images, landmarks, profiles and arbitrary attachments never enter history. */
export function sessionSummaryData(summary: LiveSessionSummary): LiveSessionSummary {
  return { durationMs: summary.durationMs, repetitionCount: summary.repetitionCount, sampledFrames: summary.sampledFrames,
    trackedFrames: summary.trackedFrames, lostFrames: summary.lostFrames, cleanRepetitions: summary.cleanRepetitions,
    spokenCues: summary.spokenCues.map(c => ({ code: c.code, text: c.text, atMs: c.atMs })),
    cueCandidatesCount: summary.cueCandidatesCount, errorBreakdown: { ...summary.errorBreakdown }, trackedMs: summary.trackedMs,
    unmeasuredMs: summary.unmeasuredMs, bodyProfileUsed: summary.bodyProfileUsed,
    deviations: { knee: { samples: summary.deviations.knee.samples, mean: summary.deviations.knee.mean, max: summary.deviations.knee.max },
      hip: { samples: summary.deviations.hip.samples, mean: summary.deviations.hip.mean, max: summary.deviations.hip.max } } };
}

export function genericSessionSummaryData(summary: GenericSessionSummary): GenericSessionSummary {
  const diagnostics = genericDiagnosticsData(summary.diagnostics, summary);
  return { durationMs: summary.durationMs, repetitionCount: summary.repetitionCount, sampledFrames: summary.sampledFrames,
    trackedFrames: summary.trackedFrames, unmeasuredFrames: summary.unmeasuredFrames,
    cueCandidatesCount: summary.cueCandidatesCount, spokenCuesCount: summary.spokenCuesCount,
    bodyProfileUsed: summary.bodyProfileUsed, ...(diagnostics ? { diagnostics } : {}),
    ...(isRepetitionGoal(summary.repetitionGoal) ? { repetitionGoal: {
      sets: summary.repetitionGoal.sets, repetitionsPerSet: summary.repetitionGoal.repetitionsPerSet } } : {}) };
}

export function sessionRecordData(record: SessionRecord): SessionRecord {
  if (!isSessionRecord(record)) throw new Error('Oturum özeti geçersiz.');
  if(record.exercise==='static-pose')return {schemaVersion:3,id:record.id,savedAt:record.savedAt,exercise:'static-pose',
    reference:{intervalId:record.reference.intervalId,policyVersion:'static-pose-v1'},endReason:record.endReason,summary:staticSessionSummaryData(record.summary)};
  if (record.exercise === 'squat') {
    return { schemaVersion: 1, id: record.id, savedAt: record.savedAt, exercise: 'squat',
      reference: { repetitionId: record.reference.repetitionId, side: record.reference.side }, endReason: record.endReason,
      summary: sessionSummaryData(record.summary) };
  }
  return { schemaVersion: 2, id: record.id, savedAt: record.savedAt, exercise: 'generic-cycle',
    reference: { repetitionId: record.reference.repetitionId, policyVersion: 'generic-cycles-v1' },
    endReason: record.endReason, summary: genericSessionSummaryData(record.summary) };
}
export function readSessionHistory(raw: string | null): SessionRecord[] {
  if (!raw) return [];
  if (raw.length > MAX_SESSION_SERIALIZED_LENGTH) throw new Error('Oturum geçmişi çok büyük.');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > MAX_SESSION_RECORDS || !data.every(isSessionRecord)
    || new Set(data.map(record => record.id)).size !== data.length) throw new Error('Oturum geçmişi okunamadı.');
  return data.map(sessionRecordData);
}
export function writeSessionHistory(records: SessionRecord[]): string {
  if (records.length > MAX_SESSION_RECORDS || new Set(records.map(record => record.id)).size !== records.length)
    throw new Error('Oturum geçmişinin kayıt sınırı veya kimlikleri geçersiz.');
  const raw = JSON.stringify(records.map(sessionRecordData));
  if (raw.length > MAX_SESSION_SERIALIZED_LENGTH) throw new Error('Oturum geçmişi için yeterli alan yok.');
  return raw;
}

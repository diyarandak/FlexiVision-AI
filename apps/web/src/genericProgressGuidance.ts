import type { GenericLiveResult } from '@flexivision/core';

export type GenericProgressCue = {
  kind: 'near' | 'return' | 'completed';
  text: string;
  assessment?: 'near' | 'different' | 'unknown';
  accuracyPct?: number | null | undefined;
};

/** Reports measured milestones only. A clean cycle requires uninterrupted, compared frames. */
export function genericProgressGuidance(initialRepetitions = 0, instructions = {outbound:'Devam et.',returning:'Başlangıç duruşuna dön.'}) {
  let active = false;
  let hadDifference = false;
  let returnPrompted = false;
  let nearPrompted = false;
  let nearSince: number | null = null;
  let repetitions = initialRepetitions;
  let correctionPhase: 'outbound'|'return'|null = null;
  let recoverySince: number|null = null;
  let lastRecovery = -Infinity;

  return (result: Pick<GenericLiveResult, 'timestampMs' | 'phase' | 'progress' | 'repetitionCount' | 'observation'> & { accuracyPct?: number | null; cycleAccuracyPct?: number | null }): GenericProgressCue | null => {
    if (result.repetitionCount > repetitions) {
      repetitions = result.repetitionCount;
      const accuracy = result.cycleAccuracyPct ?? result.accuracyPct ?? undefined;
      const clean = active && !hadDifference && result.observation.status === 'correct' && (accuracy === undefined || accuracy >= 70);
      const differed = active && (hadDifference || (accuracy !== undefined && accuracy < 70));
      active = false; hadDifference = false; returnPrompted = false; nearSince = null;
      const pctText = accuracy !== undefined ? ` Referansa benzerlik %${accuracy}.` : '';
      return { kind: 'completed', assessment: clean ? 'near' : differed ? 'different' : 'unknown',
        ...(accuracy !== undefined ? { accuracyPct: accuracy } : {}),
        text: clean
          ? `Evet, ölçülen tam tekrarı referansa uygun yaptın.${pctText}`
          : differed ? `Bir tam tekrar ölçüldü.${pctText} Bazı bölümlerde referans farkı görüldü.`
            : `Bir tam tekrar ölçüldü.${pctText}` };
    }
    if (result.phase === 'waiting' || result.observation.status === 'unknown') {
      correctionPhase = null; recoverySince = null;
      active = false; hadDifference = false; returnPrompted = false; nearSince = null;
      return null;
    }
    if (!active) active = true;
    if (result.observation.status === 'incorrect') {
      hadDifference = true; correctionPhase = result.phase; recoverySince = null;
    }
    if (correctionPhase !== result.phase) { correctionPhase = null; recoverySince = null; }
    if (correctionPhase && result.observation.status === 'correct') {
      recoverySince ??= result.timestampMs;
      if (result.timestampMs-recoverySince >= 2000 && result.timestampMs-lastRecovery >= 8000) {
        correctionPhase = null; recoverySince = null; lastRecovery = result.timestampMs;
        nearPrompted = true; nearSince = null;
        return {kind:'near',text:`Evet, şimdi referansa daha yakın. ${result.phase === 'return' ? instructions.returning : instructions.outbound}`};
      }
    }
    if (result.observation.status !== 'correct' || result.phase !== 'outbound' || result.progress < .08) nearSince = null;
    else if (nearSince === null) nearSince = result.timestampMs;
    if (result.phase === 'return' && result.observation.status === 'correct' && !returnPrompted) {
      returnPrompted = true;
      return { kind: 'return', text: instructions.returning };
    }
    if (result.phase === 'outbound' && !nearPrompted && nearSince !== null
      && result.timestampMs - nearSince >= 2000) {
      nearPrompted = true;
      return { kind: 'near', text: `Evet, görünen hareketi şu anda referansa uygun yapıyorsun. ${instructions.outbound}` };
    }
    return null;
  };
}

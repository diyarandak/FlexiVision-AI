import type { RepetitionGoal } from '@flexivision/contracts';

export const DEFAULT_REPETITION_GOAL: Readonly<RepetitionGoal> = Object.freeze({ sets: 1, repetitionsPerSet: 5 });
export function isRepetitionGoal(value: unknown): value is RepetitionGoal {
  if (!value || typeof value !== 'object') return false;
  const goal = value as RepetitionGoal;
  return Number.isInteger(goal.sets) && goal.sets >= 1 && goal.sets <= 10
    && Number.isInteger(goal.repetitionsPerSet) && goal.repetitionsPerSet >= 1 && goal.repetitionsPerSet <= 30;
}

/** Counts measured full cycles only. Framing loss cannot erase or add completed repetitions. */
export function repetitionGoalProgress(goal: RepetitionGoal, measured: number) {
  if (!isRepetitionGoal(goal) || !Number.isSafeInteger(measured) || measured < 0)
    throw new Error('Set ve tekrar hedefi geçersiz.');
  const target = goal.sets * goal.repetitionsPerSet;
  const total = Math.min(measured, target), complete = total === target;
  return { target, total, complete, completedSets: Math.floor(total / goal.repetitionsPerSet),
    currentSet: complete ? goal.sets : Math.floor(total / goal.repetitionsPerSet) + 1,
    inSet: complete ? goal.repetitionsPerSet : total % goal.repetitionsPerSet };
}

export function repetitionAnnouncement(goal: RepetitionGoal, measured: number, assessment: 'near' | 'different' | 'unknown', accuracyPct?: number | null) {
  const progress = repetitionGoalProgress(goal, measured);
  if (measured < 1 || measured > progress.target) return '';
  const inSet = (measured - 1) % goal.repetitionsPerSet + 1;
  const pctStr = typeof accuracyPct === 'number' && Number.isFinite(accuracyPct) && accuracyPct > 0
    ? ` Referansa benzerlik %${accuracyPct}.` : '';
  const quality = assessment === 'near' ? `${pctStr} Evet, referansa uygun.`
    : assessment === 'different' ? `${pctStr} Bazı bölümlerde referans farkı görüldü.` : pctStr;
  const boundary = inSet === goal.repetitionsPerSet
    ? ` ${Math.ceil(measured / goal.repetitionsPerSet)}. set tamamlandı.${progress.complete
      ? ` Hedefin tamamlandı. Toplam ${measured} tekrar.`
      : ` Hazır olduğunda ${progress.currentSet}. sete geç.`}` : '';
  return `${inSet} tamamlandı.${quality}${boundary}`;
}

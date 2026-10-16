import type { GenericLiveResult } from './liveGeneric.ts';

type Reading = Pick<GenericLiveResult, 'timestampMs' | 'phase' | 'progress' | 'repetitionCount' | 'observation'>;
type Instructions = { startInstruction: string; outbound: string; returning: string };

/** Current stage reminders only: no form judgement, queued cue, or invented progress. */
export function genericCoachReminder(instructions: Instructions) {
  let scope = '', serial = 0, anchor = 0, since = 0, previousTime: number | null = null;
  return (reading: Reading): { key: string; text: string; showExample: boolean } | null => {
    const { timestampMs: time, observation, phase, progress } = reading;
    const findingStart = phase === 'waiting' && observation.status === 'unknown' && observation.reason === 'find_start';
    const eligible = findingStart || (phase !== 'waiting' && observation.status === 'correct');
    if (!eligible || !Number.isFinite(time) || !Number.isFinite(progress)) {
      scope = ''; previousTime = null;
      return null;
    }
    const nextScope = `${phase}:${reading.repetitionCount}`;
    // Missing observations cannot count as ten seconds of observed stillness.
    if (scope !== nextScope || previousTime === null || time < previousTime || time - previousTime > 500
      || Math.abs(progress - anchor) >= .025) {
      scope = nextScope; anchor = progress; since = time; serial++;
    }
    previousTime = time;
    if (time - since < 10000) return null;
    const attempt = Math.floor((time - since - 10000) / 12000);
    return {
      key: `reminder:${serial}:${attempt}`,
      text: findingStart
        ? `${instructions.startInstruction} Videodakiyle aynı açıdan görün; gölgeyle aynı yerde olman gerekmiyor.`
        : phase === 'return' ? `Hazır olduğunda ${instructions.returning.charAt(0).toLocaleLowerCase('tr')}${instructions.returning.slice(1)} Başlangıca dönünce tekrarı sayacağım.`
          : `Hazır olduğunda ${instructions.outbound.charAt(0).toLocaleLowerCase('tr')}${instructions.outbound.slice(1)}`,
      showExample: findingStart,
    };
  };
}

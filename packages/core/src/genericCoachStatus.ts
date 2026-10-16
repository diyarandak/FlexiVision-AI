import type { GenericLiveResult } from './liveGeneric.ts';

export type GenericCoachStatus = { tone: 'framing' | 'ready' | 'matching' | 'different'; title: string; symbol: string };
/** Uncertainty retires positive feedback immediately; a held start is never a completed movement. */
export function genericCoachStatus(result: Pick<GenericLiveResult, 'phase' | 'progress' | 'observation'> | null, wholeBody: boolean, personDetected = false): GenericCoachStatus {
  if (!result || !wholeBody) return { tone:'framing',title:personDetected ? 'SENİ GÖRÜYORUM' : 'KADRAJA GİR',symbol:'?' };
  if (result.observation.status === 'unknown') return { tone:'framing',
    title: ['find_start','hold_start'].includes(result.observation.reason) ? 'BAŞLANGICA GEÇ' : 'ÖLÇÜM BEKLENİYOR',symbol:'…' };
  if (result.observation.status === 'incorrect') return { tone:'different',title:'HAREKETİ DÜZELT',symbol:'!' };
  if (result.phase === 'waiting') return { tone:'ready',title:'TEKRAR TAMAM',symbol:'✓' };
  if (result.phase === 'outbound' && result.progress < .08) return { tone:'ready',title:'BAŞLANGIÇ HAZIR',symbol:'✓' };
  return { tone:'matching',title:'HAREKET UYUYOR',symbol:'✓' };
}

import type { GenericLiveResult } from './liveGeneric.ts';
import type { genericCoachingPlan } from './genericCoaching.ts';
import type { VoiceCommand } from './voiceCommand.ts';
import type { RepetitionGoal } from '@flexivision/contracts';
import { repetitionGoalProgress } from './repetitionGoal.ts';

export type CoachingQuestion = Exclude<VoiceCommand, 'finish' | 'mute' | 'unmute'>;
export function genericVoiceAnswer(command: CoachingQuestion, context: {
  plan: ReturnType<typeof genericCoachingPlan>;
  result: GenericLiveResult | null;
  fresh: boolean;
  guidance: string;
  goal?: RepetitionGoal;
}) {
  const { plan, result, fresh, guidance } = context;
  if (command === 'show_movement') return `Örneği gösteriyorum. ${plan.outbound} Sonra ${plan.returning.charAt(0).toLocaleLowerCase('tr-TR') + plan.returning.slice(1)}`;
  if (command === 'hide_movement') return 'Örneği kapattım. Kamerada hareketine devam edebilirsin.';
  if (command === 'help') return 'Seni duyuyorum. Hareketi göster, şimdi ne yapacağım, doğru yapıyor muyum, kaç tekrar yaptım veya bitir diyebilirsin. Konuşmam bittikten sonra sor.';
  if (command === 'progress' && context.goal) {
    const count = repetitionGoalProgress(context.goal, result?.repetitionCount ?? 0);
    return `Toplam ${count.total} tekrar ölçtüm. ${count.completedSets} set tamamlandı. ${count.complete ? 'Hedefin tamamlandı.'
      : `Şimdi ${count.currentSet}. settesin; bu sette ${count.inSet}/${context.goal.repetitionsPerSet} tekrar.`}`;
  }
  if (command === 'progress') return result?.repetitionCount
    ? `${result.repetitionCount} tam tekrar ölçtüm.` : 'Henüz tam bir tekrar ölçmedim. Hareketi tamamlayıp başlangıç duruşuna dön.';
  if (!fresh || !result) return 'Şu anda güncel ölçüm alamıyorum. Başın, ellerin ve ayakların kamerada görünsün.';
  if (result.observation.status === 'unknown') return `${command === 'check_form' ? 'Henüz doğru veya yanlış diyemiyorum. ' : ''}${guidance}`;
  if (result.observation.status === 'incorrect') return result.observation.errors[0]?.message ?? 'Görünen bölüm referanstan farklı. İşaretli hedefe yaklaş.';
  if (result.phase === 'waiting') return 'Başlangıca dönüşün ölçüldü. Yeni tekrar için başlangıç duruşunu koru.';
  const action = result.phase === 'return' ? plan.returning : plan.outbound;
  if (command === 'check_form') return result.phase === 'outbound' && result.progress < .08
    ? `Başlangıç duruşun eşleşti; hareketi henüz ölçmedim. ${action}`
    : `Evet, şu anda görünen bölüm referansa yakın. ${action}`;
  return action;
}

export type VoiceCommand = 'finish' | 'mute' | 'unmute' | 'show_movement' | 'hide_movement' | 'next_step' | 'check_form' | 'repeat_guidance' | 'progress' | 'help';

/** Exact commands only: ordinary sentences, negation and partial speech do not act. */
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const text = transcript.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(flexi|flexivision|fleksi) /, '');
  if (['bitir', 'oturumu bitir', 'egzersizi bitir', 'durdur'].includes(text)) return 'finish';
  if (['sesi kapat', 'sessize al'].includes(text)) return 'mute';
  if (['sesi ac', 'sesi geri ac'].includes(text)) return 'unmute';
  if (['hareketi goster', 'ornegi goster', 'nasil yapacagim', 'nasil yapilir', 'hareketi gosterir misin', 'bir daha goster'].includes(text)) return 'show_movement';
  if (['kaldir', 'kapat', 'tamam', 'tamamdir', 'tama', 'anladim', 'hareketi kaldir', 'ornegi kaldir', 'rehberi kaldir', 'hareketi kapat', 'ornegi kapat', 'rehberi kapat', 'sil', 'hareketi sil'].includes(text)) return 'hide_movement';
  if (['ne yapacagim', 'simdi ne yapacagim', 'ne yapmaliyim', 'simdi ne yapayim', 'sirada ne var', 'sonra ne yapacagim'].includes(text)) return 'next_step';
  if (['dogru mu', 'dogru mu yapiyorum', 'dogru yapiyor muyum', 'dogru yaptim mi', 'yanlis mi yapiyorum', 'hareketim nasil'].includes(text)) return 'check_form';
  if (['tekrar soyle', 'bir daha soyle', 'tekrar eder misin', 'anlamadim', 'duymadim'].includes(text)) return 'repeat_guidance';
  if (['kac tekrar', 'kac tekrar yaptim', 'kac oldu', 'kacinci tekrar'].includes(text)) return 'progress';
  if (['yardim', 'yardim et', 'ne sorabilirim', 'ne diyebilirim', 'beni duyuyor musun'].includes(text)) return 'help';
  return null;
}

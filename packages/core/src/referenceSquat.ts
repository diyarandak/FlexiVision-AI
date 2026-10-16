import type {
  MotionMap,
  ReferenceDecision,
  ReferenceEvidence,
  RejectionCode,
  SquatCycleAnalysis,
} from '@flexivision/contracts';
import { evaluateReference } from './reference.ts';
import { detectSquatCycles } from './squatCycles.ts';
import { SIDE_VIEW_POLICY, sideViewEvidence } from './cameraView.ts';

export const REFERENCE_REJECTION_MESSAGES: Record<RejectionCode, { label: string; guidance: string }> = Object.freeze({
  body_not_visible: {
    label: 'Gerekli eklemler görünmüyor',
    guidance: 'Omuz, kalça, diz ve ayak bileklerinin hareket boyunca kadrajda kaldığı bir video seç.',
  },
  multiple_people: {
    label: 'Birden fazla kişi var',
    guidance: 'Kadrajda yalnızca tek bir kişinin bulunduğu bir video seç.',
  },
  unsupported_view: {
    label: 'Kamera açısı desteklenmiyor',
    guidance: 'Squat analizi için egzersizi tam profilden (yandan) gösteren, sabit açılı bir video kullan.',
  },
  unsupported_motion: {
    label: 'Desteklenen hareket algılanamadı',
    guidance: 'Hareketi squat formuna uygun (iniş, dip ve çıkış) gerçekleştirdiğin bir video seç.',
  },
  incomplete_repetition: {
    label: 'Tamamlanmış tekrar yok',
    guidance: 'Ayakta → çömelme → tekrar ayakta sırasını içeren en az bir tam squat bulunmalı. Kaydı ayakta başlat, çömel ve tekrar ayağa kalktıktan sonra bitir; başlangıçta ve sonda kısa süre ayakta kal.',
  },
  duration_out_of_range: {
    label: 'Video süresi uygun değil',
    guidance: 'Video 3 ile 60 saniye arasında olmalıdır.',
  },
  insufficient_frames: {
    label: 'Yetersiz kare sayısı',
    guidance: 'Analiz için en az 15 örnek kare gerekir.',
  },
  invalid_evidence: {
    label: 'Geçersiz video verisi',
    guidance: 'Video verisi okunamadı veya bozuk kareler içeriyor.',
  },
});

export function squatCycleMessage(analysis: SquatCycleAnalysis): { label: string; guidance: string } {
  switch (analysis.incompleteCause) {
    case 'missing_standing_start_and_end': return {
      label: 'Tekrarın ayakta başlangıcı ve dönüşü eksik',
      guidance: 'Ölçümlerde çömelmiş → ayakta → çömelmiş sırası var. Şablon için ayakta → çömelme → tekrar ayakta sırası gerekiyor. Kesilmemiş bir tekrar içeren video seç. Yeni çekimde kaydı ayakta başlat ve çömelip tekrar ayağa kalktıktan sonra bitir.',
    };
    case 'missing_standing_start': return {
      label: 'Tekrarın ayakta başlangıcı eksik',
      guidance: 'Ölçümler çömelmiş duruşla başlıyor ve ayağa kalkışı gösteriyor. Öncesindeki ayakta başlangıç ve iniş de görünmeli. Kaydı ayakta başlatıp çömelerek tekrar ayağa döndüğün tam bir video seç.',
    };
    case 'missing_standing_end': return {
      label: 'Tekrarın ayakta dönüşü eksik',
      guidance: 'Ayakta başlangıç ve çömelme ölçülmüş, ancak sonrasındaki ayakta dönüş eksik. Videoyu çömelirken bitirme; tekrar ayağa kalkıp kısa süre ayakta kalana kadar kaydı sürdür.',
    };
    case 'tracking_gap': return {
      label: 'Tekrar boyunca ölçümler kesintisiz değil',
      guidance: 'Ölçümler arasında eksik kare veya zaman boşluğu var; parçalar birleştirilerek tam tekrar sayılmaz. Omuz, kalça, diz ve ayak bileğinin hareket boyunca göründüğü, kesintisiz bir video seç.',
    };
    default: return REFERENCE_REJECTION_MESSAGES.incomplete_repetition;
  }
}

export function squatReferenceEvidence(
  map: MotionMap,
  analysis: SquatCycleAnalysis = detectSquatCycles(map)
): ReferenceEvidence {
  const durationMs = map.sequence.durationMs;
  const sampledFrames = map.quality.sampledFrames;
  const usableFrames = map.quality.usableFrames;
  const multiPersonFrames = map.quality.multiPersonFrames;
  const completeRepetitions = analysis.repetitions.length;

  // A visible left/right joint sequence is not evidence of a side-on camera.
  const views = map.sequence.frames.map(frame => frame.people.length === 1
    ? sideViewEvidence(frame.people[0]!, map.sequence.width, map.sequence.height) : 'unknown');
  const supported = views.filter(view => view === 'supported').length;
  const unsupported = views.filter(view => view === 'unsupported').length;
  const view: ReferenceEvidence['view'] = views.length >= SIDE_VIEW_POLICY.minFrames && supported >= SIDE_VIEW_POLICY.minFrames
    && supported / views.length >= SIDE_VIEW_POLICY.minSupportedRatio ? 'supported'
    : unsupported / Math.max(1, views.length) >= SIDE_VIEW_POLICY.minSupportedRatio ? 'unsupported' : 'unknown';

  // No full preset cycle is inconclusive; it does not prove an unrelated exercise.
  const motion: ReferenceEvidence['motion'] = analysis.repetitions.length >= 1 ? 'supported' : 'unknown';

  return {
    durationMs,
    sampledFrames,
    usableFrames,
    multiPersonFrames,
    view,
    motion,
    completeRepetitions,
  };
}

export function evaluateSquatReference(
  map: MotionMap,
  analysis: SquatCycleAnalysis = detectSquatCycles(map)
): { evidence: ReferenceEvidence; decision: ReferenceDecision } {
  const evidence = squatReferenceEvidence(map, analysis);
  const decision = evaluateReference(evidence);
  return { evidence, decision };
}

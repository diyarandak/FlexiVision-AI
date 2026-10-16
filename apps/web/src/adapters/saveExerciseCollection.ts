import type { ExerciseTemplate } from '@flexivision/contracts';
import type { ReferenceTemplateRepository } from '@flexivision/application';
import type { ReferenceVideoRepository } from './referenceVideoRepository.ts';

/** The numeric reference and the source video form one user-visible save action. */
export async function saveExerciseCollection(
  references: ReferenceTemplateRepository,
  videos: ReferenceVideoRepository,
  template: ExerciseTemplate,
  name: string,
  video: File,
) {
  const record = await references.save(template, name);
  try {
    await videos.save(record.id, video);
    return record;
  } catch {
    try {
      await references.remove(record.id);
    } catch {
      throw new Error('Video kaydedilemedi; hareket şablonu kısmen kalmış olabilir. Egzersizlerim bölümünü kontrol et.');
    }
    throw new Error('Video cihazına kaydedilemedi. Boş alanı ve tarayıcı depolama iznini kontrol edip tekrar dene.');
  }
}

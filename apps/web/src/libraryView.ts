import type { SavedReferenceTemplate } from '@flexivision/contracts';

export type LibraryKind = 'all' | 'free' | 'squat' | 'static';
export type LibraryOrder = 'recent' | 'name';
const searchText = (value: string) => value.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '');

export function libraryView(records: readonly SavedReferenceTemplate[], query: string, kind: LibraryKind, order: LibraryOrder) {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  return records.filter(record => {
    const type = record.template.kind === 'static-pose-template' ? 'static' : record.template.kind === 'generic-cycle-template' ? 'free' : 'squat';
    return (kind === 'all' || kind === type) && terms.every(term => searchText(record.name).includes(term));
  }).sort((a, b) => (order === 'name' ? a.name.localeCompare(b.name, 'tr-TR') : b.savedAt.localeCompare(a.savedAt)) || a.id.localeCompare(b.id));
}

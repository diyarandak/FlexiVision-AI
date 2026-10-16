export const APP_SECTIONS = ['vucudum', 'egzersizlerim', 'gecmis'] as const;
export type AppSection = typeof APP_SECTIONS[number];
export function appSection(hash: string): AppSection {
  const name = hash.replace(/^#/, '');
  return APP_SECTIONS.find(section => section === name) ?? 'vucudum';
}

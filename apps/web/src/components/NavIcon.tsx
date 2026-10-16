import type { AppSection } from '../navigation.ts';

export function NavIcon({ section }: { section: AppSection }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {section === 'vucudum' ? <><circle cx="12" cy="5" r="2.3" /><path d="M7 11l-2 5m12-5 2 5M8 10h8l-1 7H9l-1-7Zm1 7-1 5m7-5 1 5" /></>
      : section === 'egzersizlerim' ? <><rect x="3" y="3" width="18" height="18" rx="6" /><path d="m10 8 6 4-6 4V8Z" /></>
        : <><path d="M4 7a9 9 0 1 1-1 9M3 3v5h5m4-1v5l3 2" /></>}
  </svg>;
}

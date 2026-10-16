export const ATTEMPT_REPORT_KEY='flexivision.last-attempt-report.v1';
export const ATTEMPT_REPORT_EVENT='flexivision-attempt-report';
const prefix='FlexiVision · Oturum inceleme raporu';
type ReportStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function saveAttemptReport(text:string,storage?:ReportStorage, key=ATTEMPT_REPORT_KEY):boolean {
  try { if(!text.startsWith(prefix)||text.length>120000)return false;(storage??localStorage).setItem(key,text);return true; }catch{return false;}
}
export function readAttemptReport(storage?:ReportStorage, key=ATTEMPT_REPORT_KEY):string|null {
  const text=(storage??localStorage).getItem(key);
  if(text===null)return null;
  if(!text.startsWith(prefix)||text.length>120000)throw new Error('Son deneme raporu okunamadı.');
  return text;
}
export function clearAttemptReport(storage?:ReportStorage, key=ATTEMPT_REPORT_KEY){(storage??localStorage).removeItem(key);}

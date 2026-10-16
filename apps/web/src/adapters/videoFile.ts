/** Android file pickers can omit MIME. In that case the browser decoder is the final check. */
export function supportedVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type.toLowerCase())) return true;
  return (!file.type || file.type === 'application/octet-stream') && /\.(mp4|webm|mov)$/i.test(file.name);
}

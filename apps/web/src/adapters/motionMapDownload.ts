import type { MotionMap } from '@flexivision/contracts';

export function downloadMotionMap(map: MotionMap) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'flexivision-motion-map.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Point3 { x: number; y: number; z: number }

/** All points must share the same metric scale. Raw normalized image x/y is not enough. */
export function jointAngleDegrees(a: Point3, vertex: Point3, b: Point3): number | null {
  const values = [a.x, a.y, a.z, vertex.x, vertex.y, vertex.z, b.x, b.y, b.z];
  if (values.some(value => !Number.isFinite(value))) return null;
  const u = [a.x - vertex.x, a.y - vertex.y, a.z - vertex.z] as const;
  const v = [b.x - vertex.x, b.y - vertex.y, b.z - vertex.z] as const;
  const lengthProduct = Math.hypot(...u) * Math.hypot(...v);
  if (lengthProduct < 1e-8) return null;
  const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengthProduct;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

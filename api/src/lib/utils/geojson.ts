/**
 * GeoJSON utility functions shared across route handlers.
 *
 * These helpers convert raw DuckDB rows into GeoJSON Features,
 * handling BigInt conversion and JSON-encoded array fields.
 */

/**
 * Convert BigInt values to Numbers (or strings if unsafe) and
 * parse JSON-encoded array fields (route_ids, route_names, restrictions).
 */
export function convertBigInts(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'bigint') {
      result[key] = Number.isSafeInteger(Number(value))
        ? Number(value)
        : value.toString();
    } else if (
      typeof value === 'string' &&
      (key === 'route_ids' || key === 'route_names' || key === 'restrictions')
    ) {
      try {
        const parsed = JSON.parse(value);
        result[key] = Array.isArray(parsed) ? parsed : value;
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert a raw DuckDB row (with a `geometry` column) into a GeoJSON Feature.
 * The geometry column may be a JSON string or already-parsed object.
 */
export function rowToFeature(row: Record<string, unknown>): GeoJSON.Feature {
  const { geometry, ...properties } = row;

  let geom: GeoJSON.Geometry;
  if (typeof geometry === 'string') {
    geom = JSON.parse(geometry) as GeoJSON.Geometry;
  } else if (typeof geometry === 'object' && geometry !== null) {
    geom = geometry as GeoJSON.Geometry;
  } else {
    throw new Error('Invalid geometry in result');
  }

  return {
    type: 'Feature',
    geometry: geom,
    properties: convertBigInts(properties),
  };
}

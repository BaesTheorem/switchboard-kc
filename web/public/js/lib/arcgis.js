// ArcGIS REST feature queries (the city's and the state's open map layers).
// They answer browsers directly (CORS), so no relay is needed.

/** Features near a point (within `miles`), or all features when no point is given. */
export async function query(layer, { near, miles, where = "1=1", limit = 500, timeout = 30000 } = {}) {
  const q = new URLSearchParams({ where, outFields: "*", outSR: "4326", returnGeometry: "true", resultRecordCount: String(limit), f: "json" });
  if (near) {
    q.set("geometry", `${near.lng},${near.lat}`);
    q.set("geometryType", "esriGeometryPoint");
    q.set("inSR", "4326");
    q.set("spatialRel", "esriSpatialRelIntersects");
    if (miles) { q.set("distance", String(miles)); q.set("units", "esriSRUnit_StatuteMile"); }
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${layer}/query?${q}`, { signal: ctl.signal });
    const o = await r.json();
    if (o.error) throw new Error(o.error.message || "The map server returned an error.");
    return o.features || [];
  } finally {
    clearTimeout(t);
  }
}

export const attrs = (f) => f?.attributes || {};
export const point = (f) => (f?.geometry && typeof f.geometry.x === "number" ? { lat: f.geometry.y, lng: f.geometry.x } : null);
/** A field as trimmed text whatever its JSON type. */
export const text = (a, k) => (a?.[k] == null ? "" : String(a[k]).trim());

export const KCMO = "https://services.arcgis.com/4o5uMWTHuOhUVJPd/arcgis/rest/services";

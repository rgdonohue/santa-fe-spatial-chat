import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Feature, Geometry } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapView.css';

interface MapViewProps {
  features: Feature<Geometry, Record<string, unknown>>[];
  selectedFeature: Feature<Geometry, Record<string, unknown>> | null;
  onFeatureClick: (feature: Feature<Geometry, Record<string, unknown>>) => void;
}

const RESULTS_SOURCE = 'query-results';
const RESULTS_FILL_LAYER = 'query-results-fill';
const RESULTS_LINE_LAYER = 'query-results-line';
const RESULTS_POINT_LAYER = 'query-results-point';
const SELECTED_SOURCE = 'selected-feature';
const SELECTED_LAYER = 'selected-feature-layer';

// Steelblue color for all features
const FILL_COLOR = '#4682b4';
const STROKE_COLOR = '#2c5270';

/**
 * Escape HTML entities to prevent XSS attacks
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert a MapLibre feature to a plain GeoJSON feature
 * MapLibre features have non-serializable geometry objects
 */
function toPlainFeature(
  feature: maplibregl.MapGeoJSONFeature
): Feature<Geometry, Record<string, unknown>> {
  return {
    type: 'Feature',
    geometry: feature.geometry as Geometry,
    properties: { ...feature.properties },
    id: feature.id,
  };
}

export function MapView({
  features,
  selectedFeature,
  onFeatureClick,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'carto-light': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [
          {
            id: 'carto-light',
            type: 'raster',
            source: 'carto-light',
          },
        ],
      },
      center: [-105.94, 35.69], // Santa Fe
      zoom: 12,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      const m = map.current;
      if (!m) return;

      // Add results source (empty initially)
      m.addSource(RESULTS_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Add selected feature source
      m.addSource(SELECTED_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Fill layer for polygons - steelblue
      m.addLayer({
        id: RESULTS_FILL_LAYER,
        type: 'fill',
        source: RESULTS_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': FILL_COLOR,
          'fill-opacity': 0.4,
        },
      });

      // Line layer for polygons and linestrings - darker stroke
      m.addLayer({
        id: RESULTS_LINE_LAYER,
        type: 'line',
        source: RESULTS_SOURCE,
        filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]],
        paint: {
          'line-color': STROKE_COLOR,
          'line-width': 1,
        },
      });

      // Point layer
      m.addLayer({
        id: RESULTS_POINT_LAYER,
        type: 'circle',
        source: RESULTS_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': FILL_COLOR,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });

      // Selected feature highlight layer
      m.addLayer({
        id: SELECTED_LAYER,
        type: 'line',
        source: SELECTED_SOURCE,
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4,
        },
      });
    });

    // Click handler for features
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const m = map.current;
      if (!m) return;

      const clickedFeatures = m.queryRenderedFeatures(e.point, {
        layers: [RESULTS_FILL_LAYER, RESULTS_LINE_LAYER, RESULTS_POINT_LAYER],
      });

      if (clickedFeatures.length > 0) {
        const feature = clickedFeatures[0];
        if (feature) {
          // Convert to plain GeoJSON to avoid serialization issues
          onFeatureClick(toPlainFeature(feature));
        }
      }
    };

    map.current.on('click', handleClick);

    // Create popup for hover tooltips
    popup.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'map-tooltip',
    });

    // Hover handlers with tooltip
    const handleMouseMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const m = map.current;
      if (!m || !e.features || e.features.length === 0) return;

      m.getCanvas().style.cursor = 'pointer';

      const feature = e.features[0];
      if (!feature) return;

      const props = feature.properties;
      if (!props) return;

      // Build tooltip content with HTML escaping
      const zoneCode = escapeHtml(String(props['ZDESC'] ?? props['zoning'] ?? props['zone_code'] ?? 'N/A'));
      const zoneDesc = escapeHtml(String(props['DESC_'] ?? props['description'] ?? props['zone_name'] ?? ''));
      const objectId = escapeHtml(String(props['OBJECTID'] ?? props['id'] ?? ''));

      let html = '<div class="tooltip-content">';
      if (objectId) {
        html += `<div class="tooltip-row"><strong>ID:</strong> ${objectId}</div>`;
      }
      html += `<div class="tooltip-row"><strong>Zone:</strong> ${zoneCode}</div>`;
      if (zoneDesc && zoneDesc !== zoneCode) {
        html += `<div class="tooltip-row tooltip-desc">${zoneDesc}</div>`;
      }
      html += '</div>';

      popup.current?.setLngLat(e.lngLat).setHTML(html).addTo(m);
    };

    const handleMouseLeave = () => {
      if (map.current) {
        map.current.getCanvas().style.cursor = '';
      }
      popup.current?.remove();
    };

    map.current.on('mousemove', RESULTS_FILL_LAYER, handleMouseMove);
    map.current.on('mousemove', RESULTS_LINE_LAYER, handleMouseMove);
    map.current.on('mousemove', RESULTS_POINT_LAYER, handleMouseMove);
    map.current.on('mouseleave', RESULTS_FILL_LAYER, handleMouseLeave);
    map.current.on('mouseleave', RESULTS_LINE_LAYER, handleMouseLeave);
    map.current.on('mouseleave', RESULTS_POINT_LAYER, handleMouseLeave);

    return () => {
      // Remove all event listeners before cleanup
      const m = map.current;
      if (m) {
        m.off('click', handleClick);
        m.off('mousemove', RESULTS_FILL_LAYER, handleMouseMove);
        m.off('mousemove', RESULTS_LINE_LAYER, handleMouseMove);
        m.off('mousemove', RESULTS_POINT_LAYER, handleMouseMove);
        m.off('mouseleave', RESULTS_FILL_LAYER, handleMouseLeave);
        m.off('mouseleave', RESULTS_LINE_LAYER, handleMouseLeave);
        m.off('mouseleave', RESULTS_POINT_LAYER, handleMouseLeave);
      }
      popup.current?.remove();
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [onFeatureClick]);

  // Update results layer when features change
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const updateSource = () => {
      const source = m.getSource(RESULTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const featureCollection = {
        type: 'FeatureCollection' as const,
        features,
      };

      source.setData(featureCollection);

      // Fit bounds to features if we have any
      if (features.length > 0) {
        const bounds = getBounds(features);
        if (bounds) {
          m.fitBounds(bounds, {
            padding: 50,
            maxZoom: 15,
          });
        }
      }
    };

    if (m.isStyleLoaded()) {
      updateSource();
    } else {
      m.once('load', updateSource);
    }
  }, [features]);

  // Update selected feature highlight
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const updateSelected = () => {
      const source = m.getSource(SELECTED_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      source.setData({
        type: 'FeatureCollection',
        features: selectedFeature ? [selectedFeature] : [],
      });
    };

    if (m.isStyleLoaded()) {
      updateSelected();
    } else {
      m.once('load', updateSelected);
    }
  }, [selectedFeature]);

  return (
    <div className="map-view">
      <div ref={mapContainer} className="map-container" />
    </div>
  );
}

/**
 * Calculate bounding box for a set of features
 * Returns bounds in MapLibre format: [[swLng, swLat], [neLng, neLat]]
 */
function getBounds(
  features: Feature<Geometry, Record<string, unknown>>[]
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function processCoord(coord: number[]) {
    const lng = coord[0];
    const lat = coord[1];
    if (lng !== undefined && lat !== undefined) {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
  }

  function processCoords(coords: unknown) {
    if (!Array.isArray(coords)) return;

    if (typeof coords[0] === 'number') {
      processCoord(coords as number[]);
    } else {
      for (const c of coords) {
        processCoords(c);
      }
    }
  }

  for (const feature of features) {
    const geom = feature.geometry;
    if ('coordinates' in geom) {
      processCoords(geom.coordinates);
    }
  }

  if (minLng === Infinity) return null;

  // Return in MapLibre format: [[southwest], [northeast]]
  return [[minLng, minLat], [maxLng, maxLat]];
}


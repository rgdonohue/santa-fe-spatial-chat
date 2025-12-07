import type { Feature, Geometry } from 'geojson';
import type { StructuredQuery } from '../../types/api';
import './ResultsPanel.css';

interface ResultsPanelProps {
  features: Feature<Geometry, Record<string, unknown>>[];
  selectedFeature: Feature<Geometry, Record<string, unknown>> | null;
  query: StructuredQuery | null;
  explanation: string | null;
  onFeatureSelect: (feature: Feature<Geometry, Record<string, unknown>> | null) => void;
  onClose: () => void;
}

export function ResultsPanel({
  features,
  selectedFeature,
  query,
  explanation,
  onFeatureSelect,
  onClose,
}: ResultsPanelProps) {
  if (features.length === 0 && !query) {
    return null;
  }

  // Get property keys from first feature (for table headers)
  const propertyKeys = features.length > 0
    ? Object.keys(features[0]?.properties ?? {}).filter(
        (key) => !key.startsWith('_') && key !== 'geometry'
      )
    : [];

  // Limit displayed columns to avoid horizontal overflow
  const displayKeys = propertyKeys.slice(0, 5);
  const hasMoreColumns = propertyKeys.length > 5;

  return (
    <div className="results-panel">
      <div className="results-header">
        <div className="results-title">
          <h3>Results</h3>
          <span className="results-count">{features.length} features</span>
        </div>
        <button
          type="button"
          className="results-close-btn"
          onClick={onClose}
          aria-label="Close results"
        >
          &times;
        </button>
      </div>

      {explanation && (
        <div className="results-explanation">
          <p>{explanation}</p>
        </div>
      )}

      {query && (
        <details className="query-details">
          <summary>View Query</summary>
          <pre className="query-json">{JSON.stringify(query, null, 2)}</pre>
        </details>
      )}

      {selectedFeature && (
        <div className="selected-feature-details">
          <div className="selected-header">
            <h4>Selected Feature</h4>
            <button
              type="button"
              className="deselect-btn"
              onClick={() => onFeatureSelect(null)}
            >
              Clear
            </button>
          </div>
          <div className="feature-properties">
            {Object.entries(selectedFeature.properties ?? {})
              .filter(([key]) => !key.startsWith('_'))
              .map(([key, value]) => (
                <div key={key} className="property-row">
                  <span className="property-key">{formatKey(key)}</span>
                  <span className="property-value">{formatValue(value)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {features.length > 0 && (
        <div className="results-table-container">
          <table className="results-table">
            <thead>
              <tr>
                {displayKeys.map((key) => (
                  <th key={key}>{formatKey(key)}</th>
                ))}
                {hasMoreColumns && <th>...</th>}
              </tr>
            </thead>
            <tbody>
              {features.slice(0, 100).map((feature, index) => (
                <tr
                  key={index}
                  className={selectedFeature === feature ? 'selected' : ''}
                  onClick={() => onFeatureSelect(feature)}
                >
                  {displayKeys.map((key) => (
                    <td key={key}>
                      {formatValue(feature.properties?.[key])}
                    </td>
                  ))}
                  {hasMoreColumns && <td>...</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {features.length > 100 && (
            <div className="results-truncated">
              Showing first 100 of {features.length} features
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Format property key for display
 */
function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Format property value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }

  if (typeof value === 'number') {
    // Format numbers with commas
    if (Number.isInteger(value)) {
      return value.toLocaleString();
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

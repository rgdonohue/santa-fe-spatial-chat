/**
 * Structured Query Types
 * 
 * Type-safe query language for spatial queries.
 * This is what the LLM outputs and what we execute.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Logical operators for combining filters
 */
export type LogicalOp = 'and' | 'or';

/**
 * Supported spatial operations
 */
export type SpatialOp =
  | 'within_distance' // Features within X meters of Y
  | 'intersects' // Features that intersect Y
  | 'contains' // Features that contain Y
  | 'within' // Features within Y boundary
  | 'nearest'; // N nearest features to point/feature

/**
 * Supported attribute filter operations
 */
export type AttributeOp =
  | 'eq' // equals
  | 'neq' // not equals
  | 'gt' // greater than
  | 'gte' // greater than or equal
  | 'lt' // less than
  | 'lte' // less than or equal
  | 'in' // in array
  | 'like'; // pattern match (SQL LIKE)

/**
 * Order direction for sorting
 */
export type OrderDirection = 'asc' | 'desc';

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Attribute filter for filtering by field values
 */
export interface AttributeFilter {
  field: string;
  op: AttributeOp;
  value: string | number | boolean | (string | number | boolean)[];
}

/**
 * Spatial filter for spatial operations
 */
export interface SpatialFilter {
  op: SpatialOp;
  targetLayer: string;
  targetFilter?: AttributeFilter[]; // Optional filter on target layer
  distance?: number; // For within_distance (meters)
  limit?: number; // For nearest
}

// ============================================================================
// Aggregation Types
// ============================================================================

/**
 * Aggregate metric operation
 */
export interface AggregateMetric {
  field: string;
  op: 'count' | 'sum' | 'avg' | 'median' | 'min' | 'max';
  alias?: string; // Optional alias for the result column
}

/**
 * Aggregation specification
 */
export interface AggregateSpec {
  groupBy: string[]; // Fields to group by
  metrics: AggregateMetric[]; // Metrics to calculate
}

// ============================================================================
// Temporal Query Types
// ============================================================================

/**
 * Temporal query for comparing metrics over time
 */
export interface TemporalQuery {
  baseline: { year: number } | { date: string }; // Baseline time period
  comparison: { year: number } | { date: string }; // Comparison time period
  metric: string; // Field to compare (e.g., 'assessed_value', 'str_count')
}

// ============================================================================
// Main Query Type
// ============================================================================

/**
 * Structured query - the complete query specification
 */
export interface StructuredQuery {
  selectLayer: string; // Primary layer to query
  selectFields?: string[]; // Fields to return (default: all)
  attributeFilters?: AttributeFilter[]; // Attribute-based filters
  attributeLogic?: LogicalOp; // How to combine attribute filters (default: 'and')
  spatialFilters?: SpatialFilter[]; // Spatial filters
  spatialLogic?: LogicalOp; // How to combine spatial filters (default: 'and')
  aggregate?: AggregateSpec; // Optional aggregation (group + metrics)
  temporal?: TemporalQuery; // Optional temporal comparison
  limit?: number; // Maximum number of results
  orderBy?: { field: string; direction: OrderDirection }; // Sort order
}


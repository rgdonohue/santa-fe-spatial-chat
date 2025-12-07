/**
 * API types for the Santa Fe Spatial Chat frontend
 */

import type { Feature, Geometry } from 'geojson';

// Re-export query types from shared
export type {
  StructuredQuery,
  AttributeFilter,
  SpatialFilter,
  AggregateSpec,
  TemporalQuery,
} from '../../../shared/types/query';

export type { LayerSchema } from '../../../shared/types/geo';

/**
 * Chat message in the conversation
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  query?: StructuredQuery;
  result?: QueryResult;
  metadata?: QueryMetadata;
  error?: string;
}

/**
 * Query result metadata
 */
export interface QueryMetadata {
  count: number;
  executionTimeMs: number;
  parseTimeMs?: number;
  cache?: {
    parseHit: boolean;
    queryHit: boolean;
  };
}

/**
 * Query result from the API (GeoJSON FeatureCollection)
 */
export interface QueryResult {
  type: 'FeatureCollection';
  features: Feature<Geometry, Record<string, unknown>>[];
}

/**
 * Chat API request
 */
export interface ChatRequest {
  message: string;
  conversationId?: string;
}

/**
 * Chat API response
 */
export interface ChatResponse {
  query: StructuredQuery;
  result: QueryResult;
  explanation: string;
  confidence: number;
  metadata: QueryMetadata;
  suggestions?: string[];
}

/**
 * Query API request (direct structured query)
 */
export interface QueryRequest {
  query: StructuredQuery;
}

/**
 * Layers API response
 */
export interface LayersResponse {
  layers: Record<string, LayerSchema>;
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
  details?: string;
}

// Import StructuredQuery type for use in this file
import type { StructuredQuery } from '../../../shared/types/query';
import type { LayerSchema } from '../../../shared/types/geo';

/**
 * Query Builder
 * 
 * Converts StructuredQuery to parameterized DuckDB SQL.
 * CRS-aware: chooses correct geometry based on operation type.
 */

import type {
  StructuredQuery,
  AttributeFilter,
  SpatialFilter,
} from '../../../../shared/types/query';
import { LAYER_SCHEMAS } from '../../../../shared/types/geo';

interface QueryBuilderOptions {
  simplifyToleranceDeg?: number;
}

/**
 * Query builder that converts StructuredQuery to SQL
 */
export class QueryBuilder {
  private query: StructuredQuery;
  private options: QueryBuilderOptions;
  private params: unknown[] = [];
  private paramIndex = 1; // DuckDB uses $1, $2, etc.

  constructor(query: StructuredQuery, options: QueryBuilderOptions = {}) {
    this.query = query;
    this.options = options;
    this.validateLayer(query.selectLayer);
  }

  /**
   * Build the complete SQL query
   */
  build(): { sql: string; params: unknown[] } {
    // Check if we have a nearest neighbor query - requires special handling
    const hasNearestFilter = this.query.spatialFilters?.some(f => f.op === 'nearest');
    
    if (hasNearestFilter) {
      return this.buildNearestNeighborQuery();
    }

    const parts: string[] = [];

    // SELECT clause
    parts.push(this.buildSelect());

    // FROM clause
    parts.push(`FROM ${this.escapeIdentifier(this.query.selectLayer)}`);

    // WHERE clause
    const whereClause = this.buildWhere();
    if (whereClause) {
      parts.push(`WHERE ${whereClause}`);
    }

    // GROUP BY for aggregates
    if (this.query.aggregate) {
      const groupByFields = this.query.aggregate.groupBy.map((f) =>
        this.escapeIdentifier(f)
      );
      parts.push(`GROUP BY ${groupByFields.join(', ')}`);
    }

    // ORDER BY
    if (this.query.orderBy) {
      parts.push(
        `ORDER BY ${this.escapeIdentifier(this.query.orderBy.field)} ${this.query.orderBy.direction.toUpperCase()}`
      );
    }

    // LIMIT - only apply if explicitly set (spatial queries often want all features)
    if (this.query.limit !== undefined) {
      parts.push(`LIMIT ${this.query.limit}`);
    }

    return { sql: parts.join('\n'), params: this.params };
  }

  /**
   * Build SELECT clause
   */
  private buildSelect(): string {
    const fields: string[] = [];

    if (this.query.aggregate) {
      // For aggregates, select groupBy fields and metrics
      const groupByFields = this.query.aggregate.groupBy.map((f) =>
        this.escapeIdentifier(f)
      );
      fields.push(...groupByFields);

      // Add aggregate metrics
      for (const metric of this.query.aggregate.metrics) {
        const field = metric.field === '*' ? '1' : this.escapeIdentifier(metric.field);
        const op = metric.op.toUpperCase();
        const alias = metric.alias ?? `${metric.op}_${metric.field}`;
        
        // Handle special case for count(*)
        if (metric.op === 'count' && metric.field === '*') {
          fields.push(`COUNT(*) AS ${this.escapeIdentifier(alias)}`);
        } else {
          fields.push(`${op}(${field}) AS ${this.escapeIdentifier(alias)}`);
        }
      }
    } else {
      // Regular query: select specified fields or all (excluding internal geom columns)
      if (this.query.selectFields && this.query.selectFields.length > 0) {
        const selectFields = this.query.selectFields.map((f) =>
          this.escapeIdentifier(f)
        );
        fields.push(...selectFields);
      } else {
        // Exclude the internal geometry columns (they'll be output as GeoJSON)
        fields.push('* EXCLUDE (geom_4326, geom_utm13)');
      }
    }

    // Always include geometry (use WGS84 for GeoJSON output)
    if (!this.query.aggregate) {
      if (this.options.simplifyToleranceDeg && this.options.simplifyToleranceDeg > 0) {
        fields.push(
          `ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom_4326, ${this.options.simplifyToleranceDeg})) AS geometry`
        );
      } else {
        fields.push('ST_AsGeoJSON(geom_4326) AS geometry');
      }
    }

    return `SELECT ${fields.join(', ')}`;
  }

  /**
   * Build WHERE clause
   */
  private buildWhere(): string | null {
    const conditions: string[] = [];

    // Attribute filters
    if (this.query.attributeFilters && this.query.attributeFilters.length > 0) {
      const logic = this.query.attributeLogic ?? 'and';
      const attrConditions = this.query.attributeFilters.map((f) =>
        this.buildAttributeCondition(f)
      );
      if (attrConditions.length > 1) {
        conditions.push(`(${attrConditions.join(` ${logic.toUpperCase()} `)})`);
      } else {
        conditions.push(attrConditions[0]!);
      }
    }

    // Spatial filters
    if (this.query.spatialFilters && this.query.spatialFilters.length > 0) {
      const logic = this.query.spatialLogic ?? 'and';
      const spatialConditions = this.query.spatialFilters.map((f) =>
        this.buildSpatialCondition(f)
      );
      if (spatialConditions.length > 1) {
        conditions.push(`(${spatialConditions.join(` ${logic.toUpperCase()} `)})`);
      } else {
        conditions.push(spatialConditions[0]!);
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  /**
   * Build attribute filter condition
   */
  private buildAttributeCondition(filter: AttributeFilter): string {
    const field = this.escapeIdentifier(filter.field);
    const param = this.addParam(filter.value);

    switch (filter.op) {
      case 'eq':
        return `${field} = ${param}`;
      case 'neq':
        return `${field} != ${param}`;
      case 'gt':
        return `${field} > ${param}`;
      case 'gte':
        return `${field} >= ${param}`;
      case 'lt':
        return `${field} < ${param}`;
      case 'lte':
        return `${field} <= ${param}`;
      case 'in':
        if (Array.isArray(filter.value)) {
          const params = filter.value.map((v) => this.addParam(v));
          return `${field} IN (${params.join(', ')})`;
        }
        return `${field} = ${param}`;
      case 'like':
        return `${field} LIKE ${param}`;
      default:
        throw new Error(`Unsupported attribute operation: ${filter.op}`);
    }
  }

  /**
   * Build spatial filter condition
   * CRS-aware: uses geom_utm13 for metric ops, geom_4326 for topological ops
   */
  private buildSpatialCondition(filter: SpatialFilter): string {
    // Validate target layer
    this.validateLayer(filter.targetLayer);

    // Build subquery for target geometry
    const targetSubquery = this.buildTargetSubquery(filter);

    // Choose geometry based on operation type
    const useProjected = this.requiresProjectedGeometry(filter.op);
    const sourceGeom = useProjected ? 'geom_utm13' : 'geom_4326';
    switch (filter.op) {
      case 'within_distance': {
        if (!filter.distance) {
          throw new Error('within_distance requires distance parameter');
        }
        const distanceParam = this.addParam(filter.distance);
        return `ST_DWithin(
          ${sourceGeom},
          (${targetSubquery}),
          ${distanceParam}
        )`;
      }

      case 'intersects':
        return `ST_Intersects(
          ${sourceGeom},
          (${targetSubquery})
        )`;

      case 'contains':
        return `ST_Contains(
          ${sourceGeom},
          (${targetSubquery})
        )`;

      case 'within':
        return `ST_Within(
          ${sourceGeom},
          (${targetSubquery})
        )`;

      case 'nearest': {
        // Nearest neighbor queries are handled in buildNearestNeighborQuery()
        // This case should not be reached in buildSpatialCondition for nearest
        throw new Error('nearest operation should be handled by buildNearestNeighborQuery()');
      }

      default:
        throw new Error(`Unsupported spatial operation: ${filter.op}`);
    }
  }

  /**
   * Build subquery for target layer geometry
   */
  private buildTargetSubquery(filter: SpatialFilter): string {
    const targetLayer = this.escapeIdentifier(filter.targetLayer);
    const useProjected = this.requiresProjectedGeometry(filter.op);
    const geomField = useProjected ? 'geom_utm13' : 'geom_4326';

    let subquery = `SELECT ST_Union_Agg(${geomField}) AS target_geom_${useProjected ? 'utm13' : '4326'} FROM ${targetLayer}`;

    // Add target filters if present
    if (filter.targetFilter && filter.targetFilter.length > 0) {
      const conditions = filter.targetFilter.map((f) =>
        this.buildAttributeCondition(f)
      );
      subquery += ` WHERE ${conditions.join(' AND ')}`;
    }

    return subquery;
  }

  /**
   * Determine if operation requires projected geometry (UTM 13N)
   * Metric operations (distance, buffer, nearest) need projected CRS
   * Topological operations (intersects, contains, within) can use geographic CRS
   */
  private requiresProjectedGeometry(op: SpatialFilter['op']): boolean {
    switch (op) {
      case 'within_distance':
      case 'nearest':
        return true; // Metric operations need projected CRS
      case 'intersects':
      case 'contains':
      case 'within':
        return false; // Topological operations can use geographic CRS
      default:
        return false;
    }
  }

  /**
   * Add parameter and return placeholder
   */
  private addParam(value: unknown): string {
    this.params.push(value);
    const placeholder = `$${this.paramIndex}`;
    this.paramIndex++;
    return placeholder;
  }

  /**
   * Escape SQL identifier
   */
  private escapeIdentifier(identifier: string): string {
    // Simple escaping - wrap in double quotes
    // In production, you might want more robust escaping
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Build query for nearest neighbor operations
   * Uses proper k-NN with ORDER BY distance LIMIT
   */
  private buildNearestNeighborQuery(): { sql: string; params: unknown[] } {
    // Find the nearest filter (should only be one for now)
    const nearestFilter = this.query.spatialFilters?.find(f => f.op === 'nearest');
    if (!nearestFilter || !nearestFilter.limit) {
      throw new Error('nearest operation requires limit parameter');
    }

    // Validate layers
    this.validateLayer(this.query.selectLayer);
    this.validateLayer(nearestFilter.targetLayer);

    // Build target geometry subquery
    const sourceGeom = 'geom_utm13';
    
    const targetSubquery = this.buildTargetSubquery(nearestFilter);

    // Build SELECT clause with distance calculation
    const fields: string[] = [];
    if (this.query.selectFields && this.query.selectFields.length > 0) {
      const selectFields = this.query.selectFields.map((f) =>
        this.escapeIdentifier(f)
      );
      fields.push(...selectFields);
    } else {
      fields.push('* EXCLUDE (geom_4326, geom_utm13)');
    }
    
    // Add distance calculation
    // Note: targetSubquery returns a single geometry (ST_Union_Agg), so we can use it directly
    fields.push(`ST_Distance(${sourceGeom}, (${targetSubquery})) AS distance`);
    fields.push('ST_AsGeoJSON(geom_4326) AS geometry');

    // Build WHERE clause for other filters (excluding nearest)
    const otherFilters = this.query.spatialFilters?.filter(f => f.op !== 'nearest') || [];
    const whereConditions: string[] = [];

    // Attribute filters
    if (this.query.attributeFilters && this.query.attributeFilters.length > 0) {
      const logic = this.query.attributeLogic ?? 'and';
      const attrConditions = this.query.attributeFilters.map((f) =>
        this.buildAttributeCondition(f)
      );
      if (attrConditions.length > 1) {
        whereConditions.push(`(${attrConditions.join(` ${logic.toUpperCase()} `)})`);
      } else {
        whereConditions.push(attrConditions[0]!);
      }
    }

    // Other spatial filters (excluding nearest)
    if (otherFilters.length > 0) {
      const logic = this.query.spatialLogic ?? 'and';
      const spatialConditions = otherFilters.map((f) =>
        this.buildSpatialCondition(f)
      );
      if (spatialConditions.length > 1) {
        whereConditions.push(`(${spatialConditions.join(` ${logic.toUpperCase()} `)})`);
      } else {
        whereConditions.push(spatialConditions[0]!);
      }
    }

    // Build the query
    const parts: string[] = [];
    parts.push(`SELECT ${fields.join(', ')}`);
    parts.push(`FROM ${this.escapeIdentifier(this.query.selectLayer)}`);
    
    if (whereConditions.length > 0) {
      parts.push(`WHERE ${whereConditions.join(' AND ')}`);
    }

    // ORDER BY distance (ascending - nearest first)
    parts.push(`ORDER BY distance ASC`);

    // LIMIT to k nearest neighbors
    parts.push(`LIMIT ${nearestFilter.limit}`);

    // If query has its own limit, apply it as well (but k-NN limit takes precedence)
    if (this.query.limit !== undefined && this.query.limit < nearestFilter.limit) {
      // Use the smaller limit
      parts.pop(); // Remove k-NN limit
      parts.push(`LIMIT ${this.query.limit}`);
    }

    return { sql: parts.join('\n'), params: this.params };
  }

  /**
   * Validate layer name exists in schema
   */
  private validateLayer(layerName: string): void {
    if (!(layerName in LAYER_SCHEMAS)) {
      throw new Error(
        `Unknown layer: ${layerName}. Available layers: ${Object.keys(LAYER_SCHEMAS).join(', ')}`
      );
    }
  }
}

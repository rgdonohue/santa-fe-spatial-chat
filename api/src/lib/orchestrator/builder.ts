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

/**
 * Query builder that converts StructuredQuery to SQL
 */
export class QueryBuilder {
  private query: StructuredQuery;
  private params: unknown[] = [];
  private paramIndex = 1; // DuckDB uses $1, $2, etc.

  constructor(query: StructuredQuery) {
    this.query = query;
    this.validateLayer(query.selectLayer);
  }

  /**
   * Build the complete SQL query
   */
  build(): { sql: string; params: unknown[] } {
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

    // LIMIT
    const limit = this.query.limit ?? 100;
    parts.push(`LIMIT ${limit}`);

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
      // Regular query: select specified fields or all
      if (this.query.selectFields && this.query.selectFields.length > 0) {
        const selectFields = this.query.selectFields.map((f) =>
          this.escapeIdentifier(f)
        );
        fields.push(...selectFields);
      } else {
        fields.push('*');
      }
    }

    // Always include geometry (use WGS84 for GeoJSON output)
    if (!this.query.aggregate) {
      fields.push('ST_AsGeoJSON(geom_4326) AS geometry');
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
    const targetGeom = useProjected ? 'target_geom_utm13' : 'target_geom_4326';

    switch (filter.op) {
      case 'within_distance':
        if (!filter.distance) {
          throw new Error('within_distance requires distance parameter');
        }
        const distanceParam = this.addParam(filter.distance);
        return `ST_DWithin(
          ${sourceGeom},
          (${targetSubquery}),
          ${distanceParam}
        )`;

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

      case 'nearest':
        // Nearest requires ORDER BY and LIMIT, handled differently
        // For now, use a subquery approach
        if (!filter.limit) {
          throw new Error('nearest requires limit parameter');
        }
        const limitParam = this.addParam(filter.limit);
        return `ST_DWithin(
          ${sourceGeom},
          (${targetSubquery}),
          10000
        )`; // Use a large distance, then order by distance and limit

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

    let subquery = `SELECT ST_Union(${geomField}) AS target_geom_${useProjected ? 'utm13' : '4326'} FROM ${targetLayer}`;

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


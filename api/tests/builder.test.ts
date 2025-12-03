/**
 * Unit tests for QueryBuilder
 */

import { describe, it, expect } from 'vitest';
import { QueryBuilder } from '../src/lib/orchestrator/builder';
import type { StructuredQuery } from '../../shared/types/query';

describe('QueryBuilder', () => {
  describe('Simple attribute queries', () => {
    it('builds simple attribute filter query', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        attributeFilters: [{ field: 'zoning', op: 'eq', value: 'R-1' }],
      };

      const builder = new QueryBuilder(query);
      const { sql, params } = builder.build();

      expect(sql).toContain('FROM "parcels"');
      expect(sql).toContain('zoning');
      expect(sql).toContain('WHERE');
      expect(params).toContain('R-1');
    });

    it('builds query with multiple attribute filters (AND)', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        attributeFilters: [
          { field: 'zoning', op: 'eq', value: 'R-1' },
          { field: 'land_use', op: 'eq', value: 'residential' },
        ],
        attributeLogic: 'and',
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('zoning');
      expect(sql).toContain('land_use');
      expect(sql).toContain('AND');
    });

    it('builds query with multiple attribute filters (OR)', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        attributeFilters: [
          { field: 'zoning', op: 'eq', value: 'R-1' },
          { field: 'zoning', op: 'eq', value: 'R-2' },
        ],
        attributeLogic: 'or',
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('OR');
    });

    it('builds query with IN operator', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        attributeFilters: [
          { field: 'zoning', op: 'in', value: ['R-1', 'R-2', 'R-3'] },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql, params } = builder.build();

      expect(sql).toContain('IN');
      expect(params.length).toBeGreaterThan(0);
    });

    it('builds query with LIKE operator', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        attributeFilters: [
          { field: 'address', op: 'like', value: '%Main St%' },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql, params } = builder.build();

      expect(sql).toContain('LIKE');
      expect(params).toContain('%Main St%');
    });
  });

  describe('Spatial queries', () => {
    it('builds within_distance query using projected geometry', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        spatialFilters: [
          {
            op: 'within_distance',
            targetLayer: 'hydrology',
            distance: 500,
          },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql, params } = builder.build();

      expect(sql).toContain('ST_DWithin');
      expect(sql).toContain('geom_utm13'); // Should use projected for distance
      expect(params).toContain(500);
    });

    it('builds intersects query using geographic geometry', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        spatialFilters: [
          {
            op: 'intersects',
            targetLayer: 'flood_zones',
          },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('ST_Intersects');
      expect(sql).toContain('geom_4326'); // Should use geographic for intersects
    });

    it('builds contains query using geographic geometry', () => {
      const query: StructuredQuery = {
        selectLayer: 'zoning_districts',
        spatialFilters: [
          {
            op: 'contains',
            targetLayer: 'parcels',
          },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('ST_Contains');
      expect(sql).toContain('geom_4326');
    });

    it('builds spatial query with target filter', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        spatialFilters: [
          {
            op: 'within_distance',
            targetLayer: 'hydrology',
            targetFilter: [{ field: 'name', op: 'like', value: '%Santa Fe River%' }],
            distance: 500,
          },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('ST_DWithin');
      expect(sql).toContain('name');
      expect(sql).toContain('LIKE');
    });

    it('builds query with multiple spatial filters', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        spatialFilters: [
          {
            op: 'within_distance',
            targetLayer: 'hydrology',
            distance: 500,
          },
          {
            op: 'intersects',
            targetLayer: 'flood_zones',
          },
        ],
        spatialLogic: 'and',
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('ST_DWithin');
      expect(sql).toContain('ST_Intersects');
      expect(sql).toContain('AND');
    });
  });

  describe('Aggregate queries', () => {
    it('builds aggregate query with groupBy and metrics', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        aggregate: {
          groupBy: ['zoning'],
          metrics: [
            { field: 'assessed_value', op: 'median', alias: 'median_value' },
            { field: '*', op: 'count', alias: 'count' },
          ],
        },
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('GROUP BY');
      expect(sql).toContain('zoning');
      expect(sql).toContain('MEDIAN');
      expect(sql).toContain('COUNT');
      expect(sql).toContain('median_value');
    });
  });

  describe('Combined queries', () => {
    it('builds query with both attribute and spatial filters', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        attributeFilters: [{ field: 'zoning', op: 'eq', value: 'R-1' }],
        spatialFilters: [
          {
            op: 'within_distance',
            targetLayer: 'hydrology',
            distance: 500,
          },
        ],
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('zoning');
      expect(sql).toContain('ST_DWithin');
      expect(sql.split('AND').length).toBeGreaterThan(1);
    });

    it('builds query with limit and orderBy', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        limit: 50,
        orderBy: { field: 'assessed_value', direction: 'desc' },
      };

      const builder = new QueryBuilder(query);
      const { sql } = builder.build();

      expect(sql).toContain('LIMIT 50');
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('assessed_value');
      expect(sql).toContain('DESC');
    });
  });

  describe('Error handling', () => {
    it('throws error for unknown layer', () => {
      const query: StructuredQuery = {
        selectLayer: 'unknown_layer',
      };

      expect(() => new QueryBuilder(query)).toThrow('Unknown layer');
    });

    it('throws error for within_distance without distance', () => {
      const query: StructuredQuery = {
        selectLayer: 'parcels',
        spatialFilters: [
          {
            op: 'within_distance',
            targetLayer: 'hydrology',
            // Missing distance
          },
        ],
      };

      const builder = new QueryBuilder(query);
      expect(() => builder.build()).toThrow('within_distance requires distance');
    });
  });

  describe('CRS selection', () => {
    it('uses projected geometry for metric operations', () => {
      const metricOps: Array<'within_distance' | 'nearest'> = [
        'within_distance',
        'nearest',
      ];

      for (const op of metricOps) {
        const query: StructuredQuery = {
          selectLayer: 'parcels',
          spatialFilters: [
            {
              op,
              targetLayer: 'hydrology',
              distance: op === 'within_distance' ? 500 : undefined,
              limit: op === 'nearest' ? 5 : undefined,
            },
          ],
        };

        const builder = new QueryBuilder(query);
        const { sql } = builder.build();

        expect(sql).toContain('geom_utm13');
      }
    });

    it('uses geographic geometry for topological operations', () => {
      const topologicalOps: Array<'intersects' | 'contains' | 'within'> = [
        'intersects',
        'contains',
        'within',
      ];

      for (const op of topologicalOps) {
        const query: StructuredQuery = {
          selectLayer: 'parcels',
          spatialFilters: [
            {
              op,
              targetLayer: 'flood_zones',
            },
          ],
        };

        const builder = new QueryBuilder(query);
        const { sql } = builder.build();

        expect(sql).toContain('geom_4326');
      }
    });
  });
});


import type {
  AttributeFilter,
  SpatialFilter,
  StructuredQuery,
} from '../../../../shared/types/query';
import type { FieldType } from '../../../../shared/types/geo';
import { structuredQueryKey } from '../cache';
import type { LayerRegistry } from '../layers/registry';

export interface QueryValidationIssue {
  path: string;
  message: string;
}

export interface LimitApplication {
  query: StructuredQuery;
  truncated: boolean;
  defaultLimitApplied: boolean;
  maxFeaturesApplied: number;
  hardCap: number;
  simplifyToleranceDeg: number;
}

const DEFAULT_LIMIT_BY_GEOMETRY: Record<string, number> = {
  Point: 4000,
  LineString: 2500,
  Polygon: 1500,
  'Polygon | Point': 2000,
};

const HARD_CAP_BY_GEOMETRY: Record<string, number> = {
  Point: 10000,
  LineString: 6000,
  Polygon: 3000,
  'Polygon | Point': 5000,
};

function cloneQuery(query: StructuredQuery): StructuredQuery {
  return JSON.parse(JSON.stringify(query)) as StructuredQuery;
}

function toBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function rewriteZoningFilter(
  filter: AttributeFilter
): { rewritten: AttributeFilter; note?: string } {
  if (filter.field === 'allows_residential') {
    const booleanValue = toBooleanLike(filter.value);
    if (filter.op !== 'eq' || booleanValue === null) {
      throw new Error(
        'zoning_districts.allows_residential only supports eq true/false'
      );
    }
    if (booleanValue) {
      return {
        rewritten: { field: 'zone_code', op: 'like', value: 'R%' },
        note: 'Mapped allows_residential=true to zone_code LIKE R%',
      };
    }
    throw new Error(
      'zoning_districts.allows_residential=false is not currently supported'
    );
  }

  if (filter.field === 'allows_commercial') {
    const booleanValue = toBooleanLike(filter.value);
    if (filter.op !== 'eq' || booleanValue === null) {
      throw new Error(
        'zoning_districts.allows_commercial only supports eq true/false'
      );
    }
    if (booleanValue) {
      return {
        rewritten: { field: 'zone_code', op: 'like', value: 'C%' },
        note: 'Mapped allows_commercial=true to zone_code LIKE C%',
      };
    }
    throw new Error(
      'zoning_districts.allows_commercial=false is not currently supported'
    );
  }

  if (filter.field === 'description') {
    return {
      rewritten: { ...filter, field: 'zone_name' },
      note: 'Mapped zoning description to zone_name',
    };
  }

  return { rewritten: filter };
}

function normalizeFilter(
  filter: AttributeFilter,
  layerName: string
): { rewritten: AttributeFilter; note?: string } {
  if (layerName === 'zoning_districts') {
    return rewriteZoningFilter(filter);
  }
  return { rewritten: filter };
}

function normalizeSpatialFilter(
  filter: SpatialFilter
): { rewritten: SpatialFilter; notes: string[] } {
  const notes: string[] = [];
  const rewrittenTargetFilters = filter.targetFilter?.map((targetFilter) => {
    const normalized = normalizeFilter(targetFilter, filter.targetLayer);
    if (normalized.note) {
      notes.push(normalized.note);
    }
    return normalized.rewritten;
  });

  return {
    rewritten: {
      ...filter,
      targetFilter: rewrittenTargetFilters,
    },
    notes,
  };
}

function normalizeAttributeFilters(
  filters: AttributeFilter[] | undefined,
  layerName: string
): { filters: AttributeFilter[] | undefined; notes: string[] } {
  if (!filters) {
    return { filters, notes: [] };
  }

  const notes: string[] = [];
  const rewritten = filters.map((filter) => {
    const normalized = normalizeFilter(filter, layerName);
    if (normalized.note) {
      notes.push(normalized.note);
    }
    return normalized.rewritten;
  });

  return { filters: rewritten, notes };
}

export function normalizeStructuredQuery(
  query: StructuredQuery
): { query: StructuredQuery; notes: string[] } {
  const normalized = cloneQuery(query);
  const notes: string[] = [];

  const normalizedAttributes = normalizeAttributeFilters(
    normalized.attributeFilters,
    normalized.selectLayer
  );
  normalized.attributeFilters = normalizedAttributes.filters;
  notes.push(...normalizedAttributes.notes);

  if (normalized.spatialFilters) {
    const rewrittenSpatial = normalized.spatialFilters.map((spatialFilter) => {
      const normalizedSpatial = normalizeSpatialFilter(spatialFilter);
      notes.push(...normalizedSpatial.notes);
      return normalizedSpatial.rewritten;
    });
    normalized.spatialFilters = rewrittenSpatial;
  }

  return { query: normalized, notes };
}

function isNumericField(fieldType: FieldType | undefined): boolean {
  return typeof fieldType === 'string' && fieldType.includes('number');
}

function isBooleanField(fieldType: FieldType | undefined): boolean {
  return typeof fieldType === 'string' && fieldType.includes('boolean');
}

function ensureFieldExists(
  registry: LayerRegistry,
  layerName: string,
  fieldName: string,
  path: string,
  issues: QueryValidationIssue[]
): void {
  const layer = registry.layers[layerName];
  if (!layer) {
    issues.push({ path, message: `Unknown layer "${layerName}"` });
    return;
  }

  if (!layer.queryableFields.includes(fieldName)) {
    issues.push({
      path,
      message: `Field "${fieldName}" is not queryable on "${layerName}"`,
    });
  }
}

function validateAttributeFilterTypes(
  layerFieldTypes: Record<string, FieldType>,
  filter: AttributeFilter,
  path: string,
  issues: QueryValidationIssue[]
): void {
  const fieldType = layerFieldTypes[filter.field];

  if (['gt', 'gte', 'lt', 'lte'].includes(filter.op) && !isNumericField(fieldType)) {
    issues.push({
      path,
      message: `Operator "${filter.op}" requires a numeric field`,
    });
  }

  if (filter.op === 'eq' && isBooleanField(fieldType)) {
    const booleanValue = toBooleanLike(filter.value);
    if (booleanValue === null) {
      issues.push({
        path,
        message: 'Boolean fields require true/false values',
      });
    }
  }
}

export function validateQueryAgainstRegistry(
  query: StructuredQuery,
  registry: LayerRegistry
): QueryValidationIssue[] {
  const issues: QueryValidationIssue[] = [];
  const primaryLayer = registry.layers[query.selectLayer];

  if (!primaryLayer || !primaryLayer.isLoaded) {
    issues.push({
      path: 'selectLayer',
      message: `Layer "${query.selectLayer}" is not loaded`,
    });
    return issues;
  }

  if (query.temporal) {
    issues.push({
      path: 'temporal',
      message: 'Temporal queries are not supported yet',
    });
  }

  if (query.selectFields) {
    for (const field of query.selectFields) {
      ensureFieldExists(
        registry,
        query.selectLayer,
        field,
        `selectFields.${field}`,
        issues
      );
    }
  }

  if (query.attributeFilters) {
    for (let i = 0; i < query.attributeFilters.length; i++) {
      const filter = query.attributeFilters[i];
      if (!filter) continue;
      const path = `attributeFilters.${i}.${filter.field}`;
      ensureFieldExists(registry, query.selectLayer, filter.field, path, issues);
      validateAttributeFilterTypes(primaryLayer.schemaFields, filter, path, issues);
    }
  }

  if (query.orderBy) {
    ensureFieldExists(
      registry,
      query.selectLayer,
      query.orderBy.field,
      `orderBy.${query.orderBy.field}`,
      issues
    );
  }

  if (query.aggregate) {
    for (const field of query.aggregate.groupBy) {
      ensureFieldExists(
        registry,
        query.selectLayer,
        field,
        `aggregate.groupBy.${field}`,
        issues
      );
    }
    for (let i = 0; i < query.aggregate.metrics.length; i++) {
      const metric = query.aggregate.metrics[i];
      if (!metric || metric.field === '*') continue;
      ensureFieldExists(
        registry,
        query.selectLayer,
        metric.field,
        `aggregate.metrics.${i}.${metric.field}`,
        issues
      );
    }
  }

  if (query.spatialFilters) {
    for (let i = 0; i < query.spatialFilters.length; i++) {
      const filter = query.spatialFilters[i];
      if (!filter) continue;
      const targetLayer = registry.layers[filter.targetLayer];
      if (!targetLayer || !targetLayer.isLoaded) {
        issues.push({
          path: `spatialFilters.${i}.targetLayer`,
          message: `Target layer "${filter.targetLayer}" is not loaded`,
        });
        continue;
      }

      if (filter.targetFilter) {
        for (let j = 0; j < filter.targetFilter.length; j++) {
          const targetFilter = filter.targetFilter[j];
          if (!targetFilter) continue;
          const path = `spatialFilters.${i}.targetFilter.${j}.${targetFilter.field}`;
          ensureFieldExists(
            registry,
            filter.targetLayer,
            targetFilter.field,
            path,
            issues
          );
          validateAttributeFilterTypes(
            targetLayer.schemaFields,
            targetFilter,
            path,
            issues
          );
        }
      }
    }
  }

  return issues;
}

function getLayerGeometryType(registry: LayerRegistry, layerName: string): string {
  return registry.layers[layerName]?.geometryType ?? 'Polygon';
}

function getDefaultLimit(geometryType: string): number {
  return DEFAULT_LIMIT_BY_GEOMETRY[geometryType] ?? 1500;
}

function getHardCap(geometryType: string): number {
  return HARD_CAP_BY_GEOMETRY[geometryType] ?? 3000;
}

function getSimplifyTolerance(
  geometryType: string,
  maxFeaturesApplied: number
): number {
  if (geometryType.includes('Polygon') && maxFeaturesApplied > 1200) {
    return 0.00003;
  }
  if (geometryType.includes('LineString') && maxFeaturesApplied > 2000) {
    return 0.00002;
  }
  return 0;
}

export function applyQueryLimits(
  query: StructuredQuery,
  registry: LayerRegistry
): LimitApplication {
  const limited = cloneQuery(query);
  const geometryType = getLayerGeometryType(registry, limited.selectLayer);
  const hardCap = getHardCap(geometryType);
  const defaultLimit = getDefaultLimit(geometryType);

  let truncated = false;
  let defaultLimitApplied = false;

  if (limited.limit === undefined) {
    limited.limit = defaultLimit;
    defaultLimitApplied = true;
  } else if (limited.limit > hardCap) {
    limited.limit = hardCap;
    truncated = true;
  }

  if (limited.spatialFilters) {
    limited.spatialFilters = limited.spatialFilters.map((filter) => {
      if (filter.op !== 'nearest') {
        return filter;
      }

      const requested = filter.limit ?? 25;
      const capped = requested > hardCap ? hardCap : requested;
      if (capped !== requested) {
        truncated = true;
      }
      return {
        ...filter,
        limit: capped,
      };
    });
  }

  const maxFeaturesApplied = limited.limit ?? hardCap;
  const simplifyToleranceDeg = getSimplifyTolerance(
    geometryType,
    maxFeaturesApplied
  );

  return {
    query: limited,
    truncated,
    defaultLimitApplied,
    maxFeaturesApplied,
    hardCap,
    simplifyToleranceDeg,
  };
}

export function getQuerySourceLayers(query: StructuredQuery): string[] {
  const layers = new Set<string>([query.selectLayer]);
  for (const spatialFilter of query.spatialFilters ?? []) {
    layers.add(spatialFilter.targetLayer);
  }
  return Array.from(layers).sort();
}

export function getQueryHash(query: StructuredQuery): string {
  return structuredQueryKey(query);
}

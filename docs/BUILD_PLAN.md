# Santa Fe Spatial Chat — Build Plan

An 8-week project-based learning course. Each week has concrete deliverables that build toward a deployable spatial chat application.

**Prerequisites:** Basic React/TypeScript familiarity, Node.js installed, Ollama installed locally.

---

## Overview

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1 | Repo audit + strict TS alignment | Existing frontend + API run with types/lint clean |
| 2 | Domain types + CRS-aware data pipeline | Santa Fe data loaded in DuckDB with WGS84 + UTM geoms |
| 3 | Spatial query builder (composable) | Type-safe multi-filter query → SQL (proj vs geo geom) |
| 4 | LLM integration | NL → structured query parsing with updated schema |
| 5 | Map UI + results display | Working chat → map flow |
| 6 | Orchestrator integration | End-to-end NL → map results with logging/metrics |
| 7 | Testing + error handling + security | Coverage, graceful failures, auth/rate limits |
| 8 | Deployment + polish | Live demo, documentation, single-instance DuckDB deploy |

---

## Week 1: Repo Audit + TypeScript Foundation

**Goal:** Validate the existing repo structure, align strict TypeScript/lint configs, and ensure both apps run cleanly (no re-init of packages already present).

### Tasks

1. **Inventory repo** — confirm `api/`, `web/`, `docs/`, `scripts/`, `shared/` exist; note current tsconfig/eslint/prettier settings.

2. **Align strict TypeScript**
   - Ensure `strict: true`, `noUncheckedIndexedAccess`, `noImplicitReturns`, and `esModuleInterop` are enabled in both `api/tsconfig.json` and `web/tsconfig.json`.
   - Verify path aliases/shared types (`shared/`) wiring (symlink or package import) to avoid duplicate type definitions.

3. **ESLint/Prettier**
   - Use `@typescript-eslint/*`; enforce `no-explicit-any` (error) and `no-unused-vars` (warn), prettier integration on both packages.
   - Add a shared base config if duplication exists.

4. **Health checks**
   - Confirm `/api/health` returns `{ status: 'ok' }`.
   - Run `npm run dev` in `api` and `web` to verify startup without type/lint errors.

5. **Map bootstrap check**
   - Ensure the map renders centered on Santa Fe (-105.94, 35.69) with a placeholder layer.

6. **CI hooks (optional)**
   - Add `npm run typecheck` and `npm run lint` scripts in both packages; wire a root script to run both.

### Deliverables

- [ ] `npm run dev` starts API on :3000 (or configured port)
- [ ] `npm run dev` (web) starts frontend on :5173 (or configured port)
- [ ] `npm run typecheck` passes with zero errors in both packages
- [ ] `npm run lint` passes in both packages
- [ ] Map renders centered on Santa Fe
- [ ] `/api/health` returns `{ status: 'ok' }`

### TypeScript Focus

- `strict: true` from day one
- Practice: define request/response types for health endpoint
- Read: tsconfig strict options and what each enables

---

## Week 2: Domain Types + CRS-Aware Data Pipeline

**Goal:** Santa Fe datasets loaded into DuckDB with typed schemas, CRS enforced (WGS84 + projected UTM 13N) and reproducible ingest.

### Tasks

1. **Define domain types (`shared/types/geo.ts`)**
   ```typescript
   import type { Feature, Polygon, LineString, Point, FeatureCollection } from 'geojson';

   // Parcel properties
   interface ParcelProperties {
     parcel_id: string;
     address: string | null;
     zoning: string;
     land_use: string;
     acres: number;
     year_built: number | null;
     assessed_value: number | null;
   }

   type ParcelFeature = Feature<Polygon, ParcelProperties>;
   type ParcelCollection = FeatureCollection<Polygon, ParcelProperties>;

   // Census tract properties
   interface CensusTractProperties {
     geoid: string;
     name: string;
     total_population: number;
     median_income: number | null;
     median_age: number | null;
     pct_renter: number | null;
   }

   // Hydrology
   interface HydrologyProperties {
     name: string;
     type: 'river' | 'stream' | 'arroyo' | 'acequia';
     length_km: number;
   }

   // Layer registry (for validation)
   interface LayerSchema {
     name: string;
     geometryType: 'Polygon' | 'LineString' | 'Point';
     fields: Record<string, 'string' | 'number' | 'boolean'>;
   }

   const LAYER_SCHEMAS: Record<string, LayerSchema> = {
     parcels: {
       name: 'parcels',
       geometryType: 'Polygon',
       fields: {
         parcel_id: 'string',
         zoning: 'string',
         land_use: 'string',
         acres: 'number',
         // ...
       }
     },
     // ...
   };
   ```

2. **Create data export script (`scripts/prepare-data.ts`)**
   - Document source datasets (URLs/paths) and expected CRS per layer.
   - Enforce SRID on ingest; fail fast on unknown/missing SRID.
   - Transform geometries to:
     - `geom_4326` (WGS84) for interchange/map display
     - `geom_utm13` (EPSG:32613) for metric ops
   - Export to GeoParquet; emit `data/manifest.json` with layer name, CRS, extent, fields, counts, simplification notes.
   - Output to `api/data/`.
   - Record provenance/update cadence/licensing in `docs/DATA_SOURCES.md`.

3. **Set up DuckDB (`api/src/lib/db/`)**
   ```bash
   npm install duckdb @duckdb/node-api
   ```

   ```typescript
   // api/src/lib/db/init.ts
   import { Database } from 'duckdb-async';

   export async function initDatabase(): Promise<Database> {
     const db = await Database.create(':memory:'); // or file path, e.g., './data/sf.db'
     
     await db.exec('INSTALL spatial; LOAD spatial;');
     
     // Load layers with dual geoms
     await db.exec(`
       CREATE TABLE parcels AS 
       SELECT
         *,
         ST_Transform(ST_GeomFromWKB(geom), 4326) AS geom_4326,
         ST_Transform(ST_GeomFromWKB(geom), 32613) AS geom_utm13
       FROM ST_Read('./data/parcels.parquet');
     `);
     
     // Verify schema matches types
     const schema = await db.all('DESCRIBE parcels');
     console.log('Parcels schema:', schema);
     
     return db;
   }
   ```

4. **Create `/api/layers` endpoint**
   ```typescript
   // Returns available layers and their schemas
   app.get('/api/layers', async (c) => {
     return c.json({
       layers: Object.values(LAYER_SCHEMAS),
     });
   });
   ```

5. **Basic spatial query test (projected for distance)**
   ```typescript
   // Verify DuckDB spatial works
   const result = await db.all(`
     SELECT COUNT(*) as count 
     FROM parcels 
     WHERE ST_Area(geom_utm13) > 1000
   `);
   ```

### Deliverables

- [ ] `shared/types/geo.ts` with all domain types
- [ ] `api/data/` contains GeoParquet for: parcels, census_tracts, hydrology, zoning; `data/manifest.json` documents CRS/schema; `docs/DATA_SOURCES.md` lists provenance/update cadence/licensing
- [ ] DuckDB initializes and loads all layers on API startup with `geom_4326` and `geom_utm13`
- [ ] `/api/layers` returns layer schemas
- [ ] One working spatial query (e.g., count parcels by zoning)

### TypeScript Focus

- GeoJSON typing with `@types/geojson`
- Generic Feature types: `Feature<Polygon, ParcelProperties>`
- Type guards: `function isParcelFeature(f: Feature): f is ParcelFeature`
- Practice: type a function that filters features by property

---

## Week 3: Spatial Query Builder (Composable)

**Goal:** Type-safe translation from `StructuredQuery` to DuckDB SQL, supporting multiple spatial filters and logical ops, and choosing projected vs geographic geometry appropriately.

### Tasks

1. **Define StructuredQuery types (`shared/types/query.ts`)**
   ```typescript
   type LogicalOp = 'and' | 'or';
   type SpatialOp = 'within_distance' | 'intersects' | 'contains' | 'within' | 'nearest';
   type AttributeOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like';

   interface AttributeFilter {
     field: string;
     op: AttributeOp;
     value: string | number | (string | number)[];
   }

   interface SpatialFilter {
     op: SpatialOp;
     targetLayer: string;
     targetFilter?: AttributeFilter[];
     distance?: number;
     limit?: number;
   }

   interface AggregateMetric {
     field: string;
     op: 'count' | 'sum' | 'avg' | 'median' | 'min' | 'max';
     alias?: string;
   }

   interface AggregateSpec {
     groupBy: string[];
     metrics: AggregateMetric[];
   }

   interface StructuredQuery {
     selectLayer: string;
     selectFields?: string[];
     attributeFilters?: AttributeFilter[];
     attributeLogic?: LogicalOp; // default 'and'
     spatialFilters?: SpatialFilter[];
     spatialLogic?: LogicalOp;   // default 'and'
     aggregate?: AggregateSpec;  // optional aggregation
     limit?: number;
   }
   ```

2. **Create Zod schemas for validation**
   ```typescript
   // api/src/lib/orchestrator/validator.ts
   import { z } from 'zod';

   const attributeFilterSchema = z.object({
     field: z.string(),
     op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like']),
     value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
   });

   const aggregateMetricSchema = z.object({
     field: z.string(),
     op: z.enum(['count', 'sum', 'avg', 'median', 'min', 'max']),
     alias: z.string().optional(),
   });

   const aggregateSchema = z.object({
     groupBy: z.array(z.string()).nonempty(),
     metrics: z.array(aggregateMetricSchema).nonempty(),
   });

   const structuredQuerySchema = z.object({
     selectLayer: z.string(),
     selectFields: z.array(z.string()).optional(),
     attributeFilters: z.array(attributeFilterSchema).optional(),
     attributeLogic: z.enum(['and', 'or']).optional(),
     spatialFilters: z.array(spatialFilterSchema).optional(),
     spatialLogic: z.enum(['and', 'or']).optional(),
     aggregate: aggregateSchema.optional(),
     limit: z.number().max(1000).optional(),
   });

   export function validateQuery(input: unknown): StructuredQuery {
     return structuredQuerySchema.parse(input);
   }
   ```

3. **Build query builder (`api/src/lib/orchestrator/builder.ts`)**
   ```typescript
   export class QueryBuilder {
     private query: StructuredQuery;
     private params: unknown[] = [];

     constructor(query: StructuredQuery) {
       this.query = query;
     }

     build(): { sql: string; params: unknown[] } {
       const parts: string[] = [];
       
       // SELECT (attributes or aggregate)
       const fields = this.query.aggregate
         ? this.query.aggregate.groupBy.join(', ')
         : this.query.selectFields?.join(', ') || '*';

       const selectMetrics = this.query.aggregate
         ? this.query.aggregate.metrics.map(m => `${m.op.toUpperCase()}(${m.field === '*' ? '1' : m.field}) AS ${m.alias ?? `${m.op}_${m.field}`}`)
         : [];

       parts.push(`SELECT ${[fields, ...selectMetrics, 'ST_AsGeoJSON(geom_4326) as geometry'].filter(Boolean).join(', ')}`);
       
       // FROM
       parts.push(`FROM ${this.query.selectLayer}`);
       
       const where: string[] = [];
       
       // WHERE (attribute filters)
       if (this.query.attributeFilters?.length) {
         const logic = this.query.attributeLogic ?? 'and';
         const conditions = this.query.attributeFilters.map(f => this.buildAttributeCondition(f));
         where.push(conditions.join(` ${logic.toUpperCase()} `));
       }
       
       // Spatial filters (combine with spatialLogic)
       if (this.query.spatialFilters?.length) {
         const logic = this.query.spatialLogic ?? 'and';
         const spatialConds = this.query.spatialFilters.map(f => this.buildSpatialCondition(f));
         where.push(spatialConds.join(` ${logic.toUpperCase()} `));
       }
       
       if (where.length) {
         parts.push(`WHERE ${where.join(' AND ')}`);
       }
       
       // GROUP BY for aggregates
       if (this.query.aggregate) {
         parts.push(`GROUP BY ${this.query.aggregate.groupBy.join(', ')}`);
       }

       // LIMIT
       parts.push(`LIMIT ${this.query.limit || 100}`);
       
       return { sql: parts.join('\n'), params: this.params };
     }

     private buildAttributeCondition(filter: AttributeFilter): string {
       // Parameterized, no string interpolation
       // ...
     }

     private buildSpatialCondition(filter: SpatialFilter): string {
       // Choose geom_utm13 for metric ops, geom_4326 for intersects/contains/within
       // Build ST_DWithin, ST_Intersects, etc. with parameterization
       // ...
     }
   }
   ```

4. **Create `/api/query` endpoint**
   ```typescript
   app.post('/api/query', async (c) => {
     const body = await c.req.json();
     
     // Validate
     const query = validateQuery(body);
     
     // Build SQL
     const { sql, params } = new QueryBuilder(query).build();
     
     // Execute
     const start = performance.now();
     const rows = await db.all(sql, ...params);
     const elapsed = performance.now() - start;
     
     // Format as GeoJSON
     const features = rows.map(rowToFeature);
     
     return c.json({
       type: 'FeatureCollection',
       features,
       metadata: {
         count: features.length,
         executionTimeMs: elapsed,
       }
     });
   });
   ```

5. **Write unit tests for query builder**
   ```typescript
   // api/tests/builder.test.ts
   describe('QueryBuilder', () => {
     it('builds simple attribute query', () => {
       const query: StructuredQuery = {
         selectLayer: 'parcels',
         attributeFilters: [{ field: 'zoning', op: 'eq', value: 'R-1' }],
       };
       const { sql } = new QueryBuilder(query).build();
       expect(sql).toContain('FROM parcels');
       expect(sql).toContain('zoning');
     });

     it('builds spatial query with distance', () => {
       // ...
     });

     it('rejects invalid layer names', () => {
       // ...
     });
   });
   ```

### Deliverables

- [ ] `StructuredQuery` type defined with logic ops and multiple spatial filters
- [ ] Zod validation schema that catches invalid queries and enforces limits
- [ ] `QueryBuilder` class that produces parameterized SQL, selecting geom based on op, supporting aggregates when provided
- [ ] `/api/query` endpoint executes structured queries
- [ ] 5+ unit tests covering query builder edge cases (logic combinations, projected vs geo)
- [ ] Manual test: POST a structured query, get GeoJSON back

### TypeScript Focus

- Discriminated unions for `SpatialOp` and `AttributeOp`
- Zod schema ↔ TypeScript type inference
- Generic return types: `build(): { sql: string; params: unknown[] }`
- Practice: add a new spatial operation, trace the types through

---

## Week 4: LLM Integration

**Goal:** Natural language → StructuredQuery via local LLM, targeting the updated schema (logic + multiple spatial filters).

### Tasks

1. **Set up Ollama locally**
   ```bash
   # Install Ollama (if not already)
   # Pull model
   ollama pull qwen2.5:7b
   # or
   ollama pull llama3.1:8b
   ```

2. **Create LLM client abstraction (`api/src/lib/llm/`)**
   ```typescript
   // api/src/lib/llm/types.ts
   export interface LLMClient {
     complete(prompt: string, options?: CompletionOptions): Promise<string>;
   }

   export interface CompletionOptions {
     temperature?: number;
     maxTokens?: number;
   }

   // api/src/lib/llm/ollama.ts
   export class OllamaClient implements LLMClient {
     constructor(
       private baseUrl: string = 'http://localhost:11434',
       private model: string = 'qwen2.5:7b'
     ) {}

     async complete(prompt: string, options?: CompletionOptions): Promise<string> {
       const response = await fetch(`${this.baseUrl}/api/generate`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           model: this.model,
           prompt,
           stream: false,
           options: {
             temperature: options?.temperature ?? 0.1,
             num_predict: options?.maxTokens ?? 1000,
           },
         }),
       });
       
       const data = await response.json();
       return data.response;
     }
   }
   ```

3. **Create intent parser (`api/src/lib/orchestrator/parser.ts`)**
   ```typescript
   const PARSE_PROMPT = `You are a spatial query parser. Convert natural language queries about Santa Fe, NM into structured JSON.

   Available layers:
   - parcels: parcel_id, address, zoning, land_use, acres, year_built, assessed_value
   - census_tracts: geoid, name, total_population, median_income, median_age, pct_renter
   - hydrology: name, type (river|stream|arroyo|acequia), length_km
   - zoning_districts: zone_code, zone_name, description

   Supported operations:
   - Attribute filters: eq, neq, gt, gte, lt, lte, in, like
   - Spatial filters: within_distance (meters), intersects, contains, within

   Output ONLY valid JSON matching this schema:
   {
     "selectLayer": "string",
     "attributeFilters": [{ "field": "string", "op": "string", "value": "any" }],
     "attributeLogic": "and" | "or",
     "spatialFilters": [{ "op": "string", "targetLayer": "string", "distance": number }],
     "spatialLogic": "and" | "or"
   }

   Examples:
   User: "Show residential parcels"
   {"selectLayer": "parcels", "attributeFilters": [{"field": "zoning", "op": "in", "value": ["R-1", "R-2", "R-3"]}]}

   User: "Parcels within 500 meters of the Santa Fe River"
   {"selectLayer": "parcels", "spatialFilters": [{"op": "within_distance", "targetLayer": "hydrology", "targetFilter": [{"field": "name", "op": "like", "value": "%Santa Fe River%"}], "distance": 500}], "spatialLogic": "and"}

   User: "Census tracts with median income below 40000"
   {"selectLayer": "census_tracts", "attributeFilters": [{"field": "median_income", "op": "lt", "value": 40000}]}

   User: "Parcels within 500m of arroyos and inside the floodplain"
   {"selectLayer": "parcels", "spatialFilters": [{"op": "within_distance", "targetLayer": "hydrology", "targetFilter": [{"field": "type", "op": "like", "value": "%arroyo%"}], "distance": 500}, {"op": "intersects", "targetLayer": "floodplain"}], "spatialLogic": "and"}

   Now parse this query:
   User: "{USER_QUERY}"`;

   export class IntentParser {
     constructor(private llm: LLMClient) {}

     async parse(userQuery: string): Promise<StructuredQuery> {
       const prompt = PARSE_PROMPT.replace('{USER_QUERY}', userQuery);
       const response = await this.llm.complete(prompt);
       
       // Extract JSON from response
       const jsonMatch = response.match(/\{[\s\S]*\}/);
       if (!jsonMatch) {
         throw new Error('LLM did not return valid JSON');
       }
       
       const parsed = JSON.parse(jsonMatch[0]);
       
       // Validate against schema
       return validateQuery(parsed);
     }
   }
   ```

4. **Test parsing quality**
   ```typescript
   // Manual test cases
   const testQueries = [
     'Show all parcels',
     'Residential parcels in the Southside',
     'Census tracts with high poverty',
     'Parcels near arroyos',
     'Large parcels over 5 acres',
   ];

   for (const query of testQueries) {
     const result = await parser.parse(query);
     console.log(`"${query}" →`, result);
   }
   ```

5. **Add confidence scoring**
   - If LLM includes uncertainty markers, lower confidence
   - If query references unknown layers/fields, lower confidence
   - Return confidence alongside structured query

### Deliverables

- [ ] Ollama running locally with chosen model
- [ ] `LLMClient` interface with `OllamaClient` implementation
- [ ] `IntentParser` class that converts NL → `StructuredQuery`
- [ ] Parse prompt with layer schemas and few-shot examples
- [ ] 10+ manual test queries with documented results
- [ ] Confidence scoring (basic: 0-1 based on validation success)

### TypeScript Focus

- Interface-based abstraction (`LLMClient`)
- Async/await patterns with proper error typing
- JSON parsing with type narrowing
- Practice: add a second LLM provider (mock or Together.ai)

---

## Week 5: Map UI + Results Display

**Goal:** Frontend that sends queries and displays results on the map.

### Tasks

1. **Create API client (`web/src/lib/api.ts`)**
   ```typescript
   import type { StructuredQuery, ChatResponse } from '@/types';

   const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

   export async function sendChat(message: string): Promise<ChatResponse> {
     const response = await fetch(`${API_BASE}/api/chat`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ message }),
     });
     
     if (!response.ok) {
       throw new Error(`API error: ${response.status}`);
     }
     
     return response.json();
   }

   export async function sendQuery(query: StructuredQuery): Promise<QueryResult> {
     // Direct query endpoint
   }

   export async function getLayers(): Promise<LayerSchema[]> {
     // Fetch available layers
   }
   ```

2. **Build ChatPanel component**
   ```typescript
   // web/src/components/ChatPanel/index.tsx
   interface ChatPanelProps {
     onQueryResult: (result: QueryResult, explanation: string) => void;
   }

   export function ChatPanel({ onQueryResult }: ChatPanelProps) {
     const [messages, setMessages] = useState<ChatMessage[]>([]);
     const [input, setInput] = useState('');
     const [isLoading, setIsLoading] = useState(false);

     const handleSubmit = async () => {
       if (!input.trim() || isLoading) return;
       
       setMessages(prev => [...prev, { role: 'user', content: input }]);
       setIsLoading(true);
       
       try {
         const response = await sendChat(input);
         setMessages(prev => [...prev, { 
           role: 'assistant', 
           content: response.explanation 
         }]);
         onQueryResult(response.result, response.explanation);
       } catch (error) {
         setMessages(prev => [...prev, { 
           role: 'assistant', 
           content: 'Sorry, I couldn\'t process that query.' 
         }]);
       } finally {
         setIsLoading(false);
         setInput('');
       }
     };

     return (
       <div className="chat-panel">
         <div className="messages">
           {messages.map((m, i) => (
             <div key={i} className={`message ${m.role}`}>
               {m.content}
             </div>
           ))}
           {isLoading && <div className="loading">Thinking...</div>}
         </div>
         <input
           value={input}
           onChange={e => setInput(e.target.value)}
           onKeyDown={e => e.key === 'Enter' && handleSubmit()}
           placeholder="Ask about Santa Fe..."
         />
       </div>
     );
   }
   ```

3. **Build MapView with result layer**
   ```typescript
   // web/src/components/MapView/index.tsx
   interface MapViewProps {
     resultFeatures: GeoJSON.FeatureCollection | null;
     onFeatureClick: (feature: GeoJSON.Feature) => void;
   }

   export function MapView({ resultFeatures, onFeatureClick }: MapViewProps) {
     const mapContainer = useRef<HTMLDivElement>(null);
     const map = useRef<maplibregl.Map | null>(null);

     useEffect(() => {
       if (!mapContainer.current) return;
       
       map.current = new maplibregl.Map({
         container: mapContainer.current,
         style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
         center: [-105.94, 35.69],
         zoom: 12,
       });

       map.current.on('load', () => {
         // Add base layers (parcels, hydrology, etc.)
         // Add empty results layer
         // Optionally show layer bounds from manifest
       });

       return () => map.current?.remove();
     }, []);

     useEffect(() => {
       if (!map.current || !resultFeatures) return;
       
       const source = map.current.getSource('results') as maplibregl.GeoJSONSource;
       if (source) {
         source.setData(resultFeatures);
       }
     }, [resultFeatures]);

     return <div ref={mapContainer} className="map-container" />;
   }
   ```

4. **Build ResultsPanel**
   ```typescript
   // Table view of returned features
   // Click row → highlight on map
   // Show feature properties
   ```

5. **Wire up App component**
   ```typescript
   // web/src/App.tsx
   export function App() {
     const [results, setResults] = useState<GeoJSON.FeatureCollection | null>(null);
     const [selectedFeature, setSelectedFeature] = useState<GeoJSON.Feature | null>(null);

     return (
       <div className="app-layout">
         <ChatPanel onQueryResult={(r) => setResults(r)} />
         <MapView 
           resultFeatures={results} 
           onFeatureClick={setSelectedFeature}
         />
         <ResultsPanel 
           features={results?.features} 
           selected={selectedFeature}
         />
       </div>
     );
   }
   ```

### Deliverables

- [ ] `ChatPanel` with message history and loading state
- [ ] `MapView` with base layers and results highlight layer
- [ ] `ResultsPanel` showing feature table
- [ ] Click on map feature → show in ResultsPanel
- [ ] Click on table row → highlight on map
- [ ] API client with proper error handling
- [ ] Basic responsive layout (sidebar + map)

### TypeScript Focus

- React component props typing
- Event handler typing for MapLibre
- Discriminated unions for loading state: `'idle' | 'loading' | 'success' | 'error'`
- Practice: add strict null checks to all component props

---

## Week 6: End-to-End Orchestration

**Goal:** Complete flow from NL input to map display with explanation, with logging/metrics hooks and CRS-aware query execution.

### Tasks

1. **Create `/api/chat` endpoint**
   ```typescript
   // api/src/routes/chat.ts
   import { IntentParser } from '../lib/orchestrator/parser';
   import { QueryBuilder } from '../lib/orchestrator/builder';
   import { ResultExplainer } from '../lib/orchestrator/explainer';

   app.post('/api/chat', async (c) => {
     const { message } = await c.req.json();
     
     // 1. Parse intent
     const parser = new IntentParser(llmClient);
     let query: StructuredQuery;
     let confidence: number;
     
     try {
       query = await parser.parse(message);
       confidence = 0.9; // Adjust based on validation
     } catch (error) {
       return c.json({
         error: 'Could not understand query',
         suggestions: ['Try: "Show residential parcels"', 'Try: "Parcels near the river"'],
       }, 400);
     }
     
     // 2. Build and execute (geom selection handled in builder)
     const { sql, params } = new QueryBuilder(query).build();
     const rows = await db.all(sql, ...params);
     const features = rows.map(rowToFeature);
     
     // 3. Generate explanation
     const explainer = new ResultExplainer(llmClient);
     const explanation = await explainer.explain(query, features);
     
     return c.json({
       query,
       result: {
         type: 'FeatureCollection',
         features,
         metadata: { count: features.length },
       },
       explanation,
       confidence,
     });
   });
   ```

2. **Build ResultExplainer**
   ```typescript
   // api/src/lib/orchestrator/explainer.ts
   const EXPLAIN_PROMPT = `Given this spatial query and results, write a 1-2 sentence explanation.

   Query: {QUERY}
   Result count: {COUNT}
   Sample features: {SAMPLE}

   Be specific about locations if possible. Example:
   "Found 34 residential parcels within 500m of the Santa Fe River, primarily in the Agua Fria and downtown areas."`;

   export class ResultExplainer {
     constructor(private llm: LLMClient) {}

     async explain(query: StructuredQuery, features: Feature[]): Promise<string> {
       const prompt = EXPLAIN_PROMPT
         .replace('{QUERY}', JSON.stringify(query))
         .replace('{COUNT}', String(features.length))
         .replace('{SAMPLE}', JSON.stringify(features.slice(0, 3)));
       
       return this.llm.complete(prompt);
     }
   }
   ```

3. **Add QueryExplainer component to frontend**
   ```typescript
   // Show the structured query that was executed
   // Collapsible panel: "See what I searched for"
   // Helps users understand + debug
   ```

4. **Handle edge cases**
   - Empty results: "No parcels matched your criteria"
   - Too many results: truncate + note total
   - Unknown layer/field references: suggest alternatives
   - LLM parsing failure: return structured error

5. **Add query caching**
   ```typescript
   // Simple in-memory cache
   const queryCache = new Map<string, StructuredQuery>();

   function getCacheKey(message: string): string {
     return message.toLowerCase().trim();
   }
   ```

6. **Logging/metrics**
   - Structured log: request id, queryHash, LLM provider/model, latency (LLM + DuckDB), feature count.
   - Metrics: counters for parse success/failure, validation rejects, LLM latency, DuckDB latency.

7. **Integration test the full flow**
   ```typescript
   // tests/integration/chat.test.ts
   describe('Chat endpoint', () => {
     it('handles simple attribute query', async () => {
       const response = await request(app)
         .post('/api/chat')
         .send({ message: 'Show residential parcels' });
       
       expect(response.status).toBe(200);
       expect(response.body.result.features.length).toBeGreaterThan(0);
       expect(response.body.explanation).toBeTruthy();
     });

     it('handles spatial query', async () => {
       // ...
     });

     it('returns helpful error for unparseable query', async () => {
       // ...
     });
   });
   ```

### Deliverables

- [ ] `/api/chat` endpoint with full orchestration
- [ ] `ResultExplainer` generating contextual summaries
- [ ] `QueryExplainer` component showing structured query
- [ ] Error handling with helpful suggestions
- [ ] Basic query caching
- [ ] Logging/metrics for LLM/DuckDB latency and queryHash
- [ ] 3+ integration tests covering happy path and errors
- [ ] Demo: type NL query → see results on map with explanation

### TypeScript Focus

- Composing async operations with proper error propagation
- Return type narrowing: success vs. error responses
- Generic result types: `Result<T, E>` pattern
- Practice: add request logging with typed log entries

---

## Week 7: Testing + Error Handling + Security

**Goal:** Robust test coverage, graceful failure modes, and basic security/abuse controls (API key, CORS, rate limits, parameter caps).

### Tasks

1. **Unit tests for query builder (expand)**
   ```typescript
   describe('QueryBuilder', () => {
     describe('attribute filters', () => {
       it.each([
         ['eq', '='],
         ['neq', '!='],
         ['gt', '>'],
         ['lt', '<'],
         ['in', 'IN'],
         ['like', 'LIKE'],
       ])('handles %s operator', (op, sqlOp) => {
         // ...
       });
     });

     describe('spatial filters', () => {
       it('builds ST_DWithin for within_distance', () => {});
       it('builds ST_Intersects for intersects', () => {});
       it('handles nested target filters', () => {});
     });

     describe('validation', () => {
       it('rejects unknown layers', () => {});
       it('rejects unknown fields', () => {});
       it('rejects negative distances', () => {});
     });
   });
   ```

2. **Component tests**
   ```typescript
   // web/tests/ChatPanel.test.tsx
   describe('ChatPanel', () => {
     it('renders empty state', () => {});
     it('shows loading state during query', () => {});
     it('displays error message on failure', () => {});
     it('calls onQueryResult with response', () => {});
   });

   // web/tests/MapView.test.tsx
   describe('MapView', () => {
     it('renders map container', () => {});
     it('updates results layer when features change', () => {});
   });
   ```

3. **Error boundary for frontend**
   ```typescript
   // Catch rendering errors gracefully
   // Show "Something went wrong" + retry option
   ```

4. **API error responses**
   ```typescript
   // Consistent error format
   interface ApiError {
     error: string;
     code: 'PARSE_FAILED' | 'QUERY_FAILED' | 'LLM_UNAVAILABLE' | 'VALIDATION_ERROR';
     details?: unknown;
     suggestions?: string[];
   }
   ```

5. **LLM fallback handling**
   ```typescript
   // If Ollama is down, return helpful error
   // If LLM response is garbled, retry once
   // If still failing, return structured error
   ```

6. **Security/abuse controls**
   - API key or token auth for `/api/chat` and `/api/query`.
   - CORS: restrict to known frontend origin.
   - Rate limiting per IP and per endpoint; stricter for `/api/chat`.
   - Parameter caps: max `distance`, max `limit`, max result features (truncate with notice).

7. **Add logging**
   ```typescript
   // Log queries, execution times, errors (include request id + queryHash)
   // Useful for debugging and optimization
   ```

### Deliverables

- [ ] 80%+ test coverage on query builder
- [ ] Component tests for all major UI components
- [ ] Error boundary in React app
- [ ] Consistent API error response format
- [ ] LLM unavailability handled gracefully
- [ ] Request logging with timing and queryHash
- [ ] API key + CORS + rate limits + parameter caps enforced
- [ ] `npm test` runs all tests in < 30 seconds

### TypeScript Focus

- Test typing with Vitest
- Mock typing: `vi.fn<[string], Promise<string>>()`
- Error type narrowing in catch blocks
- Practice: type the logger interface

---

## Week 8: Deployment + Polish

**Goal:** Live demo, documentation, portfolio-ready, single-instance DuckDB deploy with clear data file handling.

### Tasks

1. **Dockerize the API**
   ```dockerfile
   # Dockerfile
   FROM node:20-slim
   WORKDIR /app
   COPY api/package*.json ./
   RUN npm ci --production
   COPY api/dist ./dist
   COPY api/data ./data
   EXPOSE 3000
   # Ensure data file is copied/read-only if bundled; or mount volume if mutable
   CMD ["node", "dist/index.js"]
   ```

2. **Deploy API to Railway (or Fly.io)**
   ```bash
   # Railway
   railway login
   railway init
   railway up

   # Set environment variables
   railway variables set LLM_PROVIDER=together
   railway variables set TOGETHER_API_KEY=xxx
   ```

3. **Deploy frontend to Vercel**
   ```bash
   cd web
   vercel --prod
   ```

4. **Swap LLM provider for production**
   ```typescript
   // Use Together.ai or Groq instead of Ollama
   const llmClient = process.env.LLM_PROVIDER === 'together'
     ? new TogetherClient(process.env.TOGETHER_API_KEY!, 'Qwen/Qwen2.5-7B-Instruct')
     : new OllamaClient();
   ```

5. **Write README**
   ```markdown
   # Santa Fe Spatial Chat

   Natural language queries over Santa Fe spatial data.

   ## Demo
   [Live demo link]

   ## Features
   - Ask questions like "Show parcels near the river"
   - See results on an interactive map
   - Understand what query was executed

   ## Tech Stack
   - TypeScript (strict mode)
   - React + MapLibre GL JS
   - Hono API
   - DuckDB with spatial extension
   - Qwen 2.5 via Ollama / Together.ai

   ## Local Development
   ...

   ## Architecture
   See [ARCHITECTURE.md](docs/ARCHITECTURE.md)
   ```

6. **Record demo video (optional)**
   - 2-minute Loom showing queries
   - Good for LinkedIn / portfolio

7. **Deployment notes**
   - Single-instance API + DuckDB (no horizontal scaling). If scaling later, separate stateless API pods from a single-writer DB process.
   - Clarify data file path (`/app/data/sf.db` or parquet directory) and how it’s baked or mounted.
   - Simple backup: nightly copy of DB or parquet artifacts to object storage.

8. **Final polish**
   - Loading animations
   - Empty state messaging
   - Mobile-responsive tweaks
   - Favicon + meta tags

### Deliverables

- [ ] API deployed and accessible
- [ ] Frontend deployed and accessible
- [ ] LLM working in production (Together.ai or Groq)
- [ ] README with setup instructions
- [ ] ARCHITECTURE.md in repo
- [ ] At least 5 example queries that work reliably
- [ ] (Optional) Demo video

---

## Week 9 (Stretch): Housing Crisis Analysis Features

**Goal:** Ship housing-focused capabilities that surface affordability and equity insights.

### Tasks

1. **Add housing datasets**
   - Short-term rentals (Airbnb/VRBO), vacancy status, affordable housing units, transit, eviction filings, historic districts, flood/wildfire risk.
   - Document provenance, update frequency, and licensing in `docs/DATA_SOURCES.md`.

2. **Implement aggregation queries**
   - Group-by + metrics in `StructuredQuery.aggregate` (count/avg/median).
   - Validate allowed fields/ops; cap group cardinality to avoid huge responses.

3. **Pre-built analysis templates**
   - Add 3–5 templates (STR density, affordability gap, vacancy hotspots, transit proximity).
   - Expose in UI as quick-start cards; show underlying structured query for transparency.

4. **Visualization for aggregates**
   - Choropleth/graduated symbol rendering for grouped results; legend with metric ranges.

5. **Exports and reporting**
   - Export options: GeoJSON/CSV/PDF with query + explanation.
   - PDF: map snapshot + summary + table for council/community use.

### Deliverables

- [ ] New housing layers loaded and documented
- [ ] Aggregation supported end-to-end (validation → builder → API → UI)
- [ ] Templates available in UI with explanations
- [ ] Choropleth/graduated symbol for aggregate views
- [ ] Export (GeoJSON/CSV) and simple PDF report

### TypeScript Focus

- Environment variable typing
- Build configuration for production
- Final review: any remaining `any` types?
- Practice: add strict CI check that fails on type errors

---

## Success Criteria

By week 8, you should be able to:

1. **Demo the app** — Type a natural language query, see results on a map with an explanation.

2. **Explain the architecture** — Walk through the flow from NL → structured query → SQL → GeoJSON → map.

3. **Show the code quality** — Strict TypeScript, tested, linted, documented.

4. **Discuss tradeoffs** — Why DuckDB over PostGIS? Why constrained query language? What would you add next?

5. **Ship it** — Live URL that works.

---

## Resources

**TypeScript:**
- Effective TypeScript (Dan Vanderkam)
- TypeScript Deep Dive (Basarat)

**DuckDB Spatial:**
- https://duckdb.org/docs/extensions/spatial.html

**MapLibre:**
- https://maplibre.org/maplibre-gl-js/docs/

**Hono:**
- https://hono.dev/

**Ollama:**
- https://ollama.ai/

**LLM APIs:**
- https://together.ai/
- https://groq.com/

---

## Stretch Goals (Post-Week 8)

If you finish early or want to keep going:

1. **Multi-turn conversation** — "Now filter those to just residential"
2. **Voice input** — Web Speech API for spoken queries
3. **Shareable query URLs** — `?q=parcels+near+river`
4. **PMTiles for base layers** — Faster initial load
5. **Query history** — Save and replay past queries
6. **Compare mode** — Side-by-side query results

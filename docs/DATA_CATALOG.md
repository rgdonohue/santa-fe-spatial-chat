# Santa Fe Spatial Chat — Data Catalog

**Last Updated:** December 11, 2025  
**Status:** 7 of 14 layers loaded (50%)

This catalog consolidates data provenance from `DATA_SOURCES.md` with live statistics from `api/data/manifest.json`. For detailed source information, licensing, and update cadences, see [DATA_SOURCES.md](./DATA_SOURCES.md).

---

## Loaded Layers (7)

| Layer | Features | Size | Geometry | Status | Source | Last Updated |
|-------|----------|------|-----------|--------|--------|--------------|
| **parcels** | 63,439 | 30MB | Polygon | ✅ Loaded | City ArcGIS REST | 2025-12-11 |
| **building_footprints** | 42,630 | 6.9MB | Polygon | ✅ Loaded | City ArcGIS REST | 2025-12-11 |
| **short_term_rentals** | 897 | 47KB | Point | ✅ Loaded | City ArcGIS REST | 2025-12-11 |
| **transit_access** | 447 | 28KB | Point | ✅ Loaded | City ArcGIS REST | 2025-12-11 |
| **census_tracts** | 57 | 483KB | Polygon | ✅ Loaded | US Census ACS | 2025-12-07 |
| **zoning_districts** | 851 | 587KB | Polygon | ✅ Loaded | City GIS | 2025-12-07 |
| **hydrology** | 109 | 219KB | LineString | ✅ Loaded | City/County GIS | 2025-12-07 |

**Total:** 108,430 features, ~38MB compressed

---

## Pending Layers (8)

| Layer | Schema Ready | Priority | Source Status | Notes |
|-------|-------------|----------|---------------|-------|
| **transit_access** | ✅ | 🔴 High | GTFS likely available | Santa Fe Trails GTFS data |
| **affordable_housing_units** | ✅ | 🔴 High | Manual acquisition | City/County Housing Dept |
| **vacancy_status** | ✅ | 🟡 Medium | Derived data | Assessor + USPS vacancy |
| **eviction_filings** | ✅ | 🟡 Medium | Privacy-sensitive | NM court records |
| **school_zones** | ✅ | 🟡 Medium | Likely available | School district GIS |
| **historic_districts** | ✅ | 🟢 Low | Likely in City GIS | Similar fetch pattern |
| **flood_zones** | ✅ | 🟡 Medium | Manual download required | FEMA NFHL ArcGIS REST has API limitations. Use MSC portal download instead |
| **wildfire_risk** | ✅ | 🟢 Low | USFS/State | May need processing |

---

## Layer Details

### ✅ parcels
- **Source:** City of Santa Fe GIS ArcGIS REST Service (Layer 126)
- **Fetch Script:** `scripts/fetch-parcels.ts`
- **Fields:** parcel_id, address, zoning, land_use, acres, year_built, assessed_value
- **Extent:** City limits only (County parcels require separate source)
- **Notes:** Max 2000 records per request (pagination handled automatically)

### ✅ building_footprints
- **Source:** City of Santa Fe GIS ArcGIS REST Service (Layer 3)
- **Fetch Script:** `scripts/fetch-buildings.ts`
- **Fields:** building_id, address, building_type, height, year_built, source, source_year
- **Extent:** City limits
- **Notes:** Building polygons with height and type information

### ✅ short_term_rentals
- **Source:** City of Santa Fe GIS ArcGIS REST Service (Layer 127)
- **Fetch Script:** `scripts/fetch-str-permits.ts`
- **Fields:** listing_id, address, business_name, property_type, permit_issued_date, permit_expiry_date
- **Extent:** City limits
- **Notes:** STR permit data (not Airbnb/VRBO scraping)

### ✅ transit_access
- **Source:** City of Santa Fe GIS ArcGIS REST Service (Layer 67)
- **Fetch Script:** `scripts/fetch-transit.ts`
- **Fields:** stop_id, stop_name, route_ids, route_names, stop_type, wheelchair_accessible
- **Extent:** City limits
- **Notes:** Bus stops from Santa Fe Trails transit system

### ✅ census_tracts
- **Source:** US Census Bureau TIGER/Line + ACS 5-year estimates
- **Fetch Script:** `scripts/fetch-public-data.ts`
- **Fields:** geoid, name, total_population, median_income, median_age, pct_renter, housing metrics
- **Extent:** Santa Fe County
- **Notes:** Annual updates (ACS 1/5-year)

### ✅ zoning_districts
- **Source:** City of Santa Fe GIS
- **Fetch Script:** `scripts/fetch-public-data.ts`
- **Fields:** zone_code, zone_name, allows_residential, allows_commercial
- **Extent:** City limits
- **Notes:** Zoning regulations and development codes

### ✅ hydrology
- **Source:** City/County GIS (arroyos layer)
- **Fetch Script:** `scripts/fetch-public-data.ts`
- **Fields:** name, type, length_km
- **Extent:** Santa Fe area
- **Notes:** Rivers, streams, arroyos, acequias

---

## Data Quality

All loaded layers include:
- ✅ Dual CRS: `geom_4326` (WGS84) for display, `geom_utm13` (UTM Zone 13N) for metric operations
- ✅ Type-safe schemas defined in `shared/types/geo.ts`
- ✅ Field mappings validated during processing
- ✅ Auto-loaded into DuckDB on API startup
- ✅ Manifest metadata in `api/data/manifest.json`

---

## Acquisition Status

### Automated (via scripts)
- ✅ parcels — `scripts/fetch-parcels.ts`
- ✅ building_footprints — `scripts/fetch-buildings.ts`
- ✅ short_term_rentals — `scripts/fetch-str-permits.ts`
- ✅ transit_access — `scripts/fetch-transit.ts`
- ✅ census_tracts — `scripts/fetch-public-data.ts`
- ✅ zoning_districts — `scripts/fetch-public-data.ts`
- ✅ hydrology — `scripts/fetch-public-data.ts`

### Manual Acquisition Required
- ⏳ affordable_housing_units — Contact City/County Housing Dept
- ⏳ vacancy_status — Combine assessor + USPS data
- ⏳ eviction_filings — Court records (privacy considerations)
- ⏳ school_zones — School district GIS
- ⏳ historic_districts — City GIS (likely similar to existing layers)
- ⏳ flood_zones — FEMA NFHL (public, standardized)
- ⏳ wildfire_risk — USFS/State sources

---

## Next Steps

1. **Affordable Housing** (High Priority)
   - Contact City/County Housing Dept
   - Request deed-restricted unit locations
   - May require manual compilation

3. **Documentation**
   - Update `DATA_SOURCES.md` with exact URLs for pending layers
   - Document licensing requirements
   - Define update cadences

---

## Related Documentation

- **Provenance & Licensing:** [DATA_SOURCES.md](./DATA_SOURCES.md)
- **Live Metadata:** `api/data/manifest.json` (auto-generated)
- **TypeScript Schemas:** `shared/types/geo.ts`
- **Data Processing:** `api/scripts/prepare-data.ts`

---

## Quick Reference

**Total Features:** 108,430  
**Total Size:** ~38MB (compressed)  
**Data Format:** GeoParquet  
**Database:** DuckDB with spatial extension  
**Auto-load:** Yes (all `.parquet` files in `api/data/`)

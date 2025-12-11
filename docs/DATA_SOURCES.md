# Santa Fe Spatial Chat — Data Sources

Document each dataset used in the project, its provenance, update cadence, known limitations, and licensing/attribution requirements. Keep this file updated as layers are added.

## Core Layers

| Layer | Source | Update Cadence | CRS | License/Attribution | Notes/Limitations |
|-------|--------|----------------|-----|---------------------|-------------------|
| parcels | City of Santa Fe GIS (ArcGIS REST) | As updated | WGS84/UTM13 (converted from 3857) | Public domain (City GIS) | City limits only; County parcels require separate source. Max 2000 records per request (pagination handled) |
| building_footprints | City of Santa Fe GIS (ArcGIS REST) | As updated | WGS84/UTM13 (converted from 3857) | Public domain (City GIS) | Building polygons with height, type, and year built. Max 2000 records per request (pagination handled) |
| census_tracts | US Census ACS | Annual (ACS 1/5-year) | WGS84/UTM13 (converted) | Public domain (US Gov) | Include income, housing stock metrics |
| hydrology | City/County GIS | TBD | WGS84/UTM13 (converted) | TBD | Verify naming for rivers/arroyos |
| zoning_districts | City of Santa Fe GIS | TBD | WGS84/UTM13 (converted) | TBD | Map zone codes to readable names |

## Housing-Focused Layers

| Layer | Source | Update Cadence | CRS | License/Attribution | Notes/Limitations |
|-------|--------|----------------|-----|---------------------|-------------------|
| short_term_rentals | City of Santa Fe GIS (ArcGIS REST) | As updated | WGS84/UTM13 (converted from 3857) | Public domain (City GIS) | STR permit data with addresses and permit dates. Max 2000 records per request (pagination handled) |
| affordable_housing_units | City/County Housing Dept | Quarterly? | WGS84/UTM13 (converted) | TBD | Track deed restrictions and expiry dates |
| vacancy_status | Assessor + USPS vacancy | Annual? | WGS84/UTM13 (converted) | TBD | Distinguish seasonal vs long-term vacancy |
| eviction_filings | NM court records (geocoded) | Monthly? | WGS84/UTM13 (converted) | TBD | Address parsing quality; privacy considerations |
| transit_access | City transit GTFS | As published | WGS84/UTM13 (converted) | Open transit data | Include stops/routes/headways if available |
| school_zones | School district GIS | Annual? | WGS84/UTM13 (converted) | TBD | Verify grade coverage and overlaps |
| historic_districts | City GIS | Annual? | WGS84/UTM13 (converted) | TBD | Note restrictions affecting development |
| flood_zones | FEMA NFHL | As published | WGS84/UTM13 (converted) | FEMA terms | Check for latest revisions |
| wildfire_risk | USFS/State | Annual? | WGS84/UTM13 (converted) | TBD | Resolution may limit parcel-level accuracy |
| water_rights/acequia_service | State/Local | TBD | WGS84/UTM13 (converted) | TBD | NM-specific considerations; data availability varies |

## Methodology Notes

- **CRS**: Ingest with SRID check; transform to WGS84 (`geom_4326`) and UTM 13N (`geom_utm13`) for metric operations.
- **Attribution**: Add required attribution strings to README/UI if licenses demand it.
- **Quality checks**: Log invalid geometries, nulls in key fields, and deduplicate records during ingest.
- **Versioning**: Record dataset versions/dates in `data/manifest.json` to keep changes auditable.

## To Do

- Fill in exact sources/URLs and licenses.
- Define update cadences with data owners.
- Add any additional housing-relevant layers as they are incorporated.

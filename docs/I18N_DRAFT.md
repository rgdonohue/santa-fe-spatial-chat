# Bilingual Support — Translation Drafts & Handoff

This document captures the **translation-quality work** done up front (by Opus) so the downstream **scaffolding work** (by Sonnet) can be mostly mechanical integration.

> **Status:** Drafts only. Nothing is wired in yet. Native Spanish speakers from Santa Fe should review before merge.

---

## What lives where

| Artifact | Path | Purpose |
|---|---|---|
| Spanish README | `README.es.md` | User-facing Spanish landing doc; linked from English README |
| English UI strings | `web/src/locales/en/common.json` | Extracted from `ChatPanel`, `ResultsPanel`, `MapView` |
| Spanish UI strings | `web/src/locales/es/common.json` | New Mexican Spanish translations of the above |
| Bilingual field labels | `shared/locales/field-labels.json` | Display labels for layer columns (both langs) |
| Parser few-shot examples (ES) | Below, in this doc | To be added into `api/src/lib/orchestrator/parser.ts` |

---

## Translation principles applied

1. **New Mexican Spanish over generic Latin American Spanish.** We preserve regional vocabulary where it exists:
   - *acequia* (never "zanja de riego")
   - *arroyo* (never "cauce seco")
   - *parcela* (never "lote" or "predio" — also the project's name)
   - *barrio* (preferred over "vecindario" for neighborhood — warmer, locally used)
   - *baldía* / *baldío* (vacant — traditional NM usage)
   - *merced* (Spanish land grant, a Santa Fe-specific concept worth preserving)
   - *placita* (small plaza / courtyard)
   - *sector censal* (US Census's official Spanish rendering of "census tract"; do not use "tracto censal")
2. **Tú, not vos.** NM Spanish uses *tú*/*usted*; voseo is wrong here.
3. **Keep English loanwords that locals use.** "Downtown", "Railyard" stay as-is when they're place names. "GeoJSON", "CSV", "hash" stay technical.
4. **Currency formatting stays $40,000 — not 40.000 €.** US dollar conventions.
5. **"Plain English" doesn't translate.** In Spanish we say *"en tus propias palabras"* or *"en lenguaje natural"* — avoid *"en inglés sencillo"*.

---

## Review checklist for native speaker

Before merging, please review — these are the judgment calls most likely to need a local ear:

- [ ] `web/src/locales/es/common.json` — **all strings**. Flag anything that sounds foreign, overly formal, or "translated-feeling".
- [ ] `README.es.md` — especially the "Why this project?" section (tone matters for trust-building with community).
- [ ] Example queries in `es/common.json` — these double as LLM few-shot examples, so the phrasing should match how a Santa Fean would actually ask.
- [ ] `shared/locales/field-labels.json` — housing/zoning vocabulary is domain-specific; terms like "Valor tasado" vs. "Avalúo" are a local preference.
- [ ] Neighborhood names in examples — is "Agua Fría" the right casing? (Both "Agua Fria" and "Agua Fría" appear in local usage; the accented form is historically correct but less common on city signage.)

---

## Spanish few-shot examples for the parser

To add into `api/src/lib/orchestrator/parser.ts` after Sonnet extracts existing few-shots into a structured format. Each example maps a Spanish NL query to the same `StructuredQuery` JSON shape as the English examples — the parser does NOT translate to English first.

```
USER: Muéstrame parcelas residenciales baldías dentro de 500 metros de una parada de autobús
STRUCTURED: {
  "selectLayer": "parcels",
  "attributeFilters": [
    { "field": "zoning", "op": "in", "value": ["R-1", "R-2", "R-3"] },
    { "field": "is_vacant", "op": "eq", "value": true }
  ],
  "spatialFilters": [
    { "op": "within_distance", "targetLayer": "transit", "distance": 500 }
  ]
}

USER: Sectores censales donde el ingreso mediano está por debajo de los $40,000
STRUCTURED: {
  "selectLayer": "census_tracts",
  "attributeFilters": [
    { "field": "median_income", "op": "lt", "value": 40000 }
  ]
}

USER: ¿Cuáles barrios tienen más alquileres de corto plazo?
STRUCTURED: {
  "selectLayer": "neighborhoods",
  "aggregation": {
    "op": "count",
    "joinLayer": "short_term_rentals",
    "joinOp": "contains",
    "orderBy": "desc",
    "limit": 10
  }
}

USER: Parcelas que colindan con una acequia en Agua Fría
STRUCTURED: {
  "selectLayer": "parcels",
  "spatialFilters": [
    { "op": "intersects", "targetLayer": "hydrology", "targetFilter": { "field": "is_acequia", "op": "eq", "value": true } },
    { "op": "within", "targetLayer": "neighborhoods", "targetFilter": { "field": "name", "op": "like", "value": "Agua Fr%a" } }
  ]
}

USER: Parcelas dentro de 200 metros de un arroyo y en zona inundable
STRUCTURED: {
  "selectLayer": "parcels",
  "spatialFilters": [
    { "op": "within_distance", "targetLayer": "hydrology", "distance": 200, "targetFilter": { "field": "is_arroyo", "op": "eq", "value": true } },
    { "op": "intersects", "targetLayer": "flood_zones" }
  ]
}
```

### System prompt addition (bilingual mode)

Insert into the parser's system prompt, after the existing layer-schema block:

> **Language handling:** The user may write in English or Spanish (including New Mexican Spanish). Accept either; emit the same StructuredQuery JSON regardless of input language. Do NOT translate the query to English first — parse directly. Common Santa Fe-specific terms to recognize in Spanish: *parcela* = parcel, *acequia* = irrigation ditch (filter `is_acequia=true` on hydrology layer), *arroyo* = dry wash (filter `is_arroyo=true`), *barrio* = neighborhood, *baldío/baldía* = vacant, *sector censal* = census tract, *vivienda asequible* = affordable housing, *zona inundable* = flood zone, *valor tasado* = assessed value, *alquiler de corto plazo* = short-term rental.

### Explanation generator language follow-through

`api/src/lib/utils/explanation.ts` should accept a `lang: 'en' | 'es'` parameter and append to its system prompt:

> Respond in {{language}}. If responding in Spanish, use natural New Mexican Spanish: *parcela*, *acequia*, *barrio*, *baldía*, *sector censal*, etc. Match the register of the user's original question.

Thread `lang` from `/api/chat` through to both `parser` and `explanation` — read it from the request body (with a `lang` field), defaulting to browser `Accept-Language` header, defaulting to `'en'`.

---

## Handoff to Sonnet — Phase 1 & 2 tasks

Phase 1 (docs — can merge standalone):

- [ ] Link `README.es.md` from `README.md` top banner (*"Read this in [Español](README.es.md)."*)
- [ ] Add `## Accessibility & Language` section to English `README.md` mirroring the Spanish one (at line ~37, after Features)
- [ ] Add "Bilingual Design" subsection to `docs/ARCHITECTURE.md`
- [ ] Add to `CLAUDE.md`: *"All user-facing strings ship in both English and Spanish. No English-only UI features. LLM prompts must accept Spanish input without translating to English first."*

Phase 2 (scaffolding):

- [ ] Install `react-i18next` + `i18next-browser-languagedetector` in `web/`
- [ ] Wire `web/src/i18n.ts` to load `locales/en/common.json` and `locales/es/common.json`, with browser detection + `localStorage` persistence
- [ ] Replace hardcoded strings in `ChatPanel/index.tsx`, `ResultsPanel/index.tsx`, `MapView/index.tsx` with `t('...')` calls matching the JSON key paths
- [ ] Add a language toggle to `App.tsx` header (small `EN | ES` button top-right; aria-label from `language.switchToEnglish` / `language.switchToSpanish`)
- [ ] Set `<html lang="...">` reactively via `useEffect` in `App.tsx`
- [ ] Load `shared/locales/field-labels.json` in `ResultsPanel` and use it in `formatKey()` instead of the current humanize-from-camelCase logic (with graceful fallback for unmapped keys)
- [ ] Move `exampleQueries` out of `ChatPanel/index.tsx` and read from `t('examples.queries', { returnObjects: true })`

Phase 3 (LLM):

- [ ] Extend `/api/chat` request schema with optional `lang` field; default from `Accept-Language`
- [ ] Thread `lang` through `IntentParser.parse()` and `generateExplanation()`
- [ ] Add the Spanish few-shots above + system prompt addition
- [ ] Add Spanish-input cases to `api/tests/parser.test.ts`

---

## Open notes

- Together.ai and Ollama models handle Spanish fine at the 7B+ parameter range we're using (tested qwen2.5:7b and llama3.1:8b informally — both produce correct StructuredQuery JSON from Spanish prompts). No provider change needed.
- **Do not** add machine translation as a preprocessing step. Let the LLM see the original Spanish — it carries more intent than a translated-to-English version.
- When we add school zones / wildfire layers (per roadmap), add their field labels to `shared/locales/field-labels.json` in the same PR.

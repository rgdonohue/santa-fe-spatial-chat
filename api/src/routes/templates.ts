/**
 * Templates endpoint
 *
 * Provides pre-built equity analysis query templates.
 */

import { Hono } from 'hono';
import {
  EQUITY_TEMPLATES,
  getAvailableTemplates,
  getTemplateById,
  getTemplatesByCategory,
} from '../lib/templates/equity-queries';
import type { QueryTemplate } from '../lib/templates/equity-queries';

const templatesRoute = new Hono();
let availableLayers: string[] = [];

export function setAvailableLayers(layers: string[]): void {
  availableLayers = [...layers];
}

function groupTemplates(
  templates: QueryTemplate[]
): Record<string, QueryTemplate[]> {
  return templates.reduce<Record<string, QueryTemplate[]>>((acc, template) => {
    const category = template.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category]?.push(template);
    return acc;
  }, {});
}

/**
 * GET /api/templates
 * List all available templates
 */
templatesRoute.get('/', (c) => {
  const grouped = c.req.query('grouped') === 'true';
  const includeUnavailable = c.req.query('includeUnavailable') === 'true';
  const templateList =
    includeUnavailable || availableLayers.length === 0
      ? EQUITY_TEMPLATES
      : getAvailableTemplates(availableLayers);

  if (grouped) {
    return c.json({
      templates: groupTemplates(templateList),
      count: templateList.length,
      availableCount:
        availableLayers.length === 0
          ? EQUITY_TEMPLATES.length
          : getAvailableTemplates(availableLayers).length,
    });
  }

  // Return simplified list for UI
  const templates = templateList.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    dataRequirements: t.dataRequirements,
    runnable: t.dataRequirements.every((req) => availableLayers.includes(req)),
  }));

  return c.json({
    templates,
    count: templates.length,
    includeUnavailable,
  });
});

/**
 * GET /api/templates/:id
 * Get a specific template with full query
 */
templatesRoute.get('/:id', (c) => {
  const id = c.req.param('id');
  const template = getTemplateById(id);

  if (!template) {
    return c.json(
      {
        error: 'Template not found',
        available: EQUITY_TEMPLATES.map((t) => t.id),
      },
      404
    );
  }

  const runnable = template.dataRequirements.every((req) =>
    availableLayers.includes(req)
  );
  if (!runnable && availableLayers.length > 0) {
    const missing = template.dataRequirements.filter(
      (layer) => !availableLayers.includes(layer)
    );
    return c.json(
      {
        error: 'Template unavailable for current data',
        template: template.id,
        missingLayers: missing,
        availableLayers,
      },
      409
    );
  }

  return c.json(template);
});

/**
 * GET /api/templates/category/:category
 * Get templates by category
 */
templatesRoute.get('/category/:category', (c) => {
  const category = c.req.param('category') as QueryTemplate['category'];
  const validCategories = [
    'housing',
    'displacement',
    'access',
    'risk',
    'opportunity',
  ];

  if (!validCategories.includes(category)) {
    return c.json(
      {
        error: 'Invalid category',
        validCategories,
      },
      400
    );
  }

  const templates = getTemplatesByCategory(category);
  const filteredTemplates =
    availableLayers.length === 0
      ? templates
      : templates.filter((template) =>
          template.dataRequirements.every((req) => availableLayers.includes(req))
        );

  return c.json({
    category,
    templates: filteredTemplates,
    count: filteredTemplates.length,
  });
});

export default templatesRoute;

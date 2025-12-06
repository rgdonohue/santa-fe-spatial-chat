/**
 * Templates endpoint
 *
 * Provides pre-built equity analysis query templates.
 */

import { Hono } from 'hono';
import {
  EQUITY_TEMPLATES,
  getTemplateById,
  getTemplatesByCategory,
  getTemplatesGrouped,
} from '../lib/templates/equity-queries';
import type { QueryTemplate } from '../lib/templates/equity-queries';

const templatesRoute = new Hono();

/**
 * GET /api/templates
 * List all available templates
 */
templatesRoute.get('/', (c) => {
  const grouped = c.req.query('grouped') === 'true';

  if (grouped) {
    return c.json({
      templates: getTemplatesGrouped(),
      count: EQUITY_TEMPLATES.length,
    });
  }

  // Return simplified list for UI
  const templates = EQUITY_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    dataRequirements: t.dataRequirements,
  }));

  return c.json({
    templates,
    count: templates.length,
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

  return c.json({
    category,
    templates,
    count: templates.length,
  });
});

export default templatesRoute;

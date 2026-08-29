import type {
  DrawingTemplateCatalogPort,
  DrawingTemplateDefinition,
} from '../application/ports/drawingTemplateCatalog.js';
import { DRAWING_TEMPLATE_CATALOG } from '../data/templateCatalog.js';

export class LegacyDrawingTemplateCatalog implements DrawingTemplateCatalogPort {
  findByName(name: string): DrawingTemplateDefinition | undefined {
    const normalized = name.trim().toLowerCase();
    const template = DRAWING_TEMPLATE_CATALOG.find(
      (candidate) => candidate.name.toLowerCase() === normalized,
    );
    return template ? { name: template.name, pointCount: template.points } : undefined;
  }
}

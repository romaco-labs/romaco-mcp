export interface DrawingTemplateDefinition {
  name: string;
  pointCount: number | null;
}

/** Discovery boundary for chart-owned drawing templates. */
export interface DrawingTemplateCatalogPort {
  findByName(name: string): DrawingTemplateDefinition | undefined;
}

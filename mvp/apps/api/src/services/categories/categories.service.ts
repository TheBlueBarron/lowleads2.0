import type { Pool } from 'pg';

export interface CategoryServiceDeps {
  db: Pool;
}

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  is_leaf: boolean;
}

export class CategoryService {
  constructor(private readonly deps: CategoryServiceDeps) {}

  // Flat list of the full tree (parents + leaves); clients build the hierarchy
  // from parent_id. Curated platform data — read-only via the API.
  async list() {
    const result = await this.deps.db.query<CategoryRow>(
      'SELECT id, parent_id, name, is_leaf FROM categories ORDER BY name',
    );
    return {
      data: result.rows.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        isLeaf: r.is_leaf,
      })),
      total: result.rows.length,
    };
  }
}

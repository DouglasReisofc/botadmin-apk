
export type CatalogCategorySummary = {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
};

export class CatalogDisabledError extends Error {
  status: number;

  constructor(message = "O catálogo de produtos digitais está desativado no novo dashboard.") {
    super(message);
    this.name = "CatalogDisabledError";
    this.status = 410;
  }
}

const emptyCategories: CatalogCategorySummary[] = [];

export const getCategoriesForUser = async (_userId: number): Promise<CatalogCategorySummary[]> => {
  void _userId;
  return emptyCategories;
};

export const getCategoryByIdForUser = async (
  _userId: number,
  _categoryId: number,
): Promise<CatalogCategorySummary | null> => {
  void _userId;
  void _categoryId;
  return null;
};

export const updateCategory = async () => {
  throw new CatalogDisabledError();
};

export const findAvailableProductForCategory = async () => {
  return null;
};

export const decrementProductResaleLimit = async () => {
  return;
};

export const restoreProductResaleLimit = async () => {
  return;
};

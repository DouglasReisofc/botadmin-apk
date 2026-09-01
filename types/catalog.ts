export type CategorySummary = {
  id: number;
  userId: number;
  name: string;
  price: number;
  sku: string;
  description: string;
  imagePath: string | null;
  isActive: boolean;
  productCount: number;
  durationDays: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminCategorySummary = CategorySummary & {
  ownerName: string;
  ownerEmail: string;
};

export type ProductSummary = {
  id: number;
  userId: number;
  categoryId: number;
  categoryName: string;
  details: string;
  filePath: string | null;
  resaleLimit: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminProductSummary = ProductSummary & {
  ownerName: string;
  ownerEmail: string;
};

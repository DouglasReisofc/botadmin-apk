export type UsefulLink = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  buttonLabel: string;
  icon: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  order: number;
  isActive: boolean;
  updatedAt: string;
};

export type UsefulLinkBanner = {
  id: number;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  mediaUrl: string;
  mediaPath: string;
  order: number;
  isActive: boolean;
  updatedAt: string;
};

export type UsefulLinksDataset = {
  links: UsefulLink[];
  banners: UsefulLinkBanner[];
};

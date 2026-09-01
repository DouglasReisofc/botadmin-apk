export interface AdminMobileOnboardingSlide {
  id: string;
  title: string;
  description: string;
  buttonLabel: string | null;
  imageUrl: string | null;
  imageStoragePath: string | null;
}

export interface AdminMobileSettings {
  appName: string;
  packageName: string;
  versionCode: number;
  versionName: string;
  serverUrl: string | null;
  updatedAt: string | null;
  minVersionCode: number | null;
  releaseNotes: string | null;
  onboardingEnabled: boolean;
  onboardingSlides: AdminMobileOnboardingSlide[];
  onboardingRevision: string | null;
}


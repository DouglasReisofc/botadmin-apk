export interface MobileArtifact {
  platform: "android" | "ios" | "windows";
  type: "apk" | "aab" | "ipa" | "exe" | "msi" | "zip";
  fileName: string;
  url: string;
  sizeBytes: number;
  updatedAt: string;
  buildType: "release" | "debug";
  versionName?: string;
  versionCode?: number;
  minVersionCode?: number;
  details?: string;
  notes?: string;
  apkUrl?: string;
}

export interface MobileArtifactsPayload {
  android?: MobileArtifact;
  androidBundle?: MobileArtifact;
  ios?: MobileArtifact;
  windows?: MobileArtifact;
  // Optional store links
  androidStoreUrl?: string;
  iosStoreUrl?: string;
  windowsStoreUrl?: string;
  // Preferred distribution mode per platform
  preferredAndroidMode?: "store" | "file";
  preferredIosMode?: "store" | "file";
  preferredWindowsMode?: "store" | "file";
  // Optional custom details text to show on the modal
  details?: string;
}

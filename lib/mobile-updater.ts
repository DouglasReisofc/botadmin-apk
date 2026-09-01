import { Capacitor, registerPlugin } from '@capacitor/core';

type UpdaterNative = {
  downloadAndInstall(options: { url: string; fileName?: string }): Promise<{ downloadId: number }>
  getInfo(): Promise<{ versionName: string | null; versionCode: number | null }>
};

export const Updater = registerPlugin<UpdaterNative>('Updater');

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

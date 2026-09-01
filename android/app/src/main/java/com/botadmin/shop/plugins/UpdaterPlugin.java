package com.botadmin.shop.plugins;

import android.app.DownloadManager;
import android.net.Uri;
import android.os.Environment;
import android.database.Cursor;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.webkit.MimeTypeMap;
import androidx.core.content.FileProvider;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import java.io.File;

@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {
  private Long currentDownloadId = null;

  @PluginMethod
  public void downloadAndInstall(PluginCall call) {
    String url = call.getString("url");
    String fileName = call.getString("fileName", "app-release.apk");
    if (url == null || url.trim().isEmpty()) {
      call.reject("Missing url");
      return;
    }

    Context ctx = getContext();
    DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
    String ext = MimeTypeMap.getFileExtensionFromUrl(url);
    String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
    if (mime == null) mime = "application/vnd.android.package-archive";
    request.setMimeType(mime);

    long downloadId = dm.enqueue(request);
    currentDownloadId = downloadId;

    BroadcastReceiver onComplete = new BroadcastReceiver() {
      @Override
      public void onReceive(Context context, Intent intent) {
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
        if (id != currentDownloadId) return;

        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(id);
        Cursor cursor = dm.query(query);
        if (cursor != null && cursor.moveToFirst()) {
          int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
          int status = cursor.getInt(statusIndex);
          if (status == DownloadManager.STATUS_SUCCESSFUL) {
            try {
              Uri fileUri = dm.getUriForDownloadedFile(id);
              if (fileUri != null) {
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(fileUri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(install);
              }
            } catch (Exception ignored) {}
          }
        }
        try { context.unregisterReceiver(this); } catch (Exception ignored) {}
      }
    };

    ctx.registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

    JSObject ret = new JSObject();
    ret.put("downloadId", downloadId);
    call.resolve(ret);
  }

  @PluginMethod
  public void getInfo(PluginCall call) {
    try {
      Context ctx = getContext();
      PackageManager pm = ctx.getPackageManager();
      PackageInfo info = pm.getPackageInfo(ctx.getPackageName(), 0);
      String versionName = info.versionName;
      long versionCode;
      try {
        versionCode = (long) info.getClass().getMethod("getLongVersionCode").invoke(info);
      } catch (Exception e) {
        versionCode = info.versionCode;
      }
      JSObject ret = new JSObject();
      ret.put("versionName", versionName);
      ret.put("versionCode", versionCode);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("getInfo failed: " + e.getMessage());
    }
  }
}

package com.botadmin.shop;

import android.Manifest;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.drawable.Animatable;
import android.graphics.drawable.AnimatedImageDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.botadmin.shop.onboarding.OnboardingController;
import com.botadmin.shop.plugins.UpdaterPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.google.android.material.button.MaterialButton;

public class MainActivity extends BridgeActivity {
  private static final int AUDIO_PERMISSION_REQUEST = 9001;
  private static final String LOG_TAG = "BotAdmMain";

  private static final String SESSION_PREFS = "botadmin.session";
  private static final String PREF_LAST_URL = "last_known_url";
  private static final String PREF_APP_HOST = "app_host";

  private PermissionRequest pendingPermissionRequest;
  private OnboardingController onboardingController;
  private SwipeRefreshLayout swipeRefreshLayout;
  private View offlineOverlay;
  private MaterialButton offlineRetryButton;
  private WebView bridgeWebView;
  private boolean lastLoadHadError = false;
  private View offlineGifView;
  private CharSequence offlineRetryOriginalText;
  private String initialUrl;
  private String lastKnownUrl;
  private String appHost;
  private SharedPreferences sessionPreferences;
  private ConnectivityManager.NetworkCallback networkCallback;
  private volatile boolean networkHasInternet = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    registerPlugin(UpdaterPlugin.class);

    sessionPreferences = getSharedPreferences(SESSION_PREFS, Context.MODE_PRIVATE);
    if (sessionPreferences != null) {
      String storedUrl = sessionPreferences.getString(PREF_LAST_URL, null);
      if (hasText(storedUrl) && !isAboutBlank(storedUrl)) {
        lastKnownUrl = storedUrl.trim();
      }
      String storedHost = sessionPreferences.getString(PREF_APP_HOST, null);
      if (hasText(storedHost)) {
        appHost = storedHost.trim().toLowerCase();
      }
    }
    captureAppHostFromUrl(BuildConfig.ONBOARDING_BASE_URL);
    if (!hasText(appHost) && hasText(lastKnownUrl)) {
      captureAppHostFromUrl(lastKnownUrl);
    }

    swipeRefreshLayout = findViewById(R.id.swipe_refresh);
    offlineOverlay = findViewById(R.id.offline_container);
    Log.d(LOG_TAG, "initial offlineOverlay=" + (offlineOverlay != null));
    if (offlineOverlay == null) {
      View root = findViewById(android.R.id.content);
      if (root instanceof ViewGroup) {
        LayoutInflater.from(this).inflate(R.layout.view_offline_overlay, (ViewGroup) root, true);
        offlineOverlay = findViewById(R.id.offline_container);
        Log.d(LOG_TAG, "inflated offlineOverlay=" + (offlineOverlay != null));
        swipeRefreshLayout = findViewById(R.id.swipe_refresh);
      }
    }
    if (offlineOverlay != null) {
      offlineOverlay.setVisibility(View.GONE);
    }
    offlineRetryButton = offlineOverlay != null ? offlineOverlay.findViewById(R.id.offline_button_retry) : null;
    offlineGifView = offlineOverlay != null ? offlineOverlay.findViewById(R.id.offline_gif) : null;
    bridgeWebView = findViewById(R.id.webview);
    Log.d(LOG_TAG, "bridgeWebView=" + (bridgeWebView != null));
    ensureInitialUrl();
    registerConnectivityWatcher();
    if (offlineRetryButton != null) {
      offlineRetryOriginalText = offlineRetryButton.getText();
      offlineRetryButton.setOnClickListener(v -> {
        offlineRetryButton.setEnabled(false);
        offlineRetryButton.setAlpha(0.6f);
        offlineRetryButton.setText(R.string.offline_reloading);
        offlineRetryButton.postDelayed(() -> offlineRetryButton.setPressed(false), 120);
        if (swipeRefreshLayout != null) {
          swipeRefreshLayout.setRefreshing(true);
        }
        if (!isConnected()) {
          offlineRetryButton.postDelayed(() -> {
            if (swipeRefreshLayout != null) {
              swipeRefreshLayout.setRefreshing(false);
            }
            showOfflineOverlay();
          }, 300);
          return;
        }
        lastLoadHadError = false;
        if (bridgeWebView != null) {
          bridgeWebView.setVisibility(View.VISIBLE);
          triggerInitialLoad();
        }
      });
    }

    if (swipeRefreshLayout != null) {
      swipeRefreshLayout.setColorSchemeResources(
        android.R.color.holo_blue_bright,
        android.R.color.holo_green_light,
        android.R.color.holo_orange_light
      );

      swipeRefreshLayout.setOnChildScrollUpCallback((parent, child) -> {
        if (getBridge() == null || getBridge().getWebView() == null) {
          return false;
        }
        return getBridge().getWebView().getScrollY() > 0;
      });

      swipeRefreshLayout.setOnRefreshListener(() -> {
        if (bridgeWebView != null) {
          bridgeWebView.reload();
          swipeRefreshLayout.postDelayed(() -> {
            if (swipeRefreshLayout.isRefreshing()) {
              swipeRefreshLayout.setRefreshing(false);
            }
          }, 4000);
        } else {
          swipeRefreshLayout.setRefreshing(false);
        }
      });
    }

    if (bridgeWebView != null && !isConnected()) {
      try {
        bridgeWebView.stopLoading();
        bridgeWebView.loadUrl("about:blank");
      } catch (Exception ignored) {}
      showOfflineOverlay();
    } else {
      hideOfflineOverlay();
    }

    if (bridgeWebView != null) {
      bridgeWebView.setWebViewClient(
        new BridgeWebViewClient(getBridge()) {
          @Override
          public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (swipeRefreshLayout != null) {
              swipeRefreshLayout.setRefreshing(false);
            }
            if (isAboutBlank(url)) {
              return;
            }
            Log.d(LOG_TAG, "onPageFinished url=" + url);
            if (lastLoadHadError && !isConnected()) {
              Log.d(LOG_TAG, "Keeping offline overlay - last load had error and still offline");
              return;
            }
            captureInitialUrlFromPage(url);
            lastLoadHadError = false;
            hideOfflineOverlay();
          }

          @Override
          public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            super.doUpdateVisitedHistory(view, url, isReload);
            if (!hasText(url) || isAboutBlank(url)) {
              return;
            }
            captureAppHostFromUrl(url);
            if (!isAppUrl(url)) {
              return;
            }
            updateLastKnownUrl(url);
          }

          @Override
          public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request == null || request.isForMainFrame()) {
              int errorCode = error != null ? error.getErrorCode() : WebViewClient.ERROR_UNKNOWN;
              boolean networkFailure = isNetworkError(errorCode);
              boolean connected = isConnected();
              Log.d(LOG_TAG, "onReceivedError mainFrame connected=" + connected + " errCode=" + errorCode + " networkFailure=" + networkFailure);
              if (!connected || networkFailure) {
                lastLoadHadError = true;
                showOfflineOverlay();
              } else {
                lastLoadHadError = false;
                hideOfflineOverlay();
              }
            }
          }

          @Override
          public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (request != null && request.isForMainFrame()) {
              int statusCode = errorResponse != null ? errorResponse.getStatusCode() : 0;
              boolean connected = isConnected();
              Log.d(LOG_TAG, "onReceivedHttpError status=" + statusCode + " connected=" + connected);
              // Considera offline apenas 5xx (servidor indisponível) ou sem conexão real
                if (statusCode >= 500 || !connected) {
                  lastLoadHadError = true;
                  showOfflineOverlay();
                } else {
                  // 4xx não são offline; deixa o site lidar (login/403/404)
                  lastLoadHadError = false;
                  hideOfflineOverlay();
                }
              }
            }
          }
        );

      if (getBridge() != null) {
        bridgeWebView.setWebChromeClient(
          new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
              runOnUiThread(() -> handlePermissionRequest(request));
            }
          }
        );
      }

    if (isConnected()) {
      String currentUrl = bridgeWebView.getUrl();
      if (!hasText(currentUrl) || isAboutBlank(currentUrl)) {
        triggerInitialLoad();
      } else {
        ensureInitialUrl();
      }
    } else {
      showOfflineOverlay();
    }
    }
    onboardingController = new OnboardingController(this, getBridge());
    onboardingController.start();
  }

  private void handlePermissionRequest(PermissionRequest request) {
    if (request == null) {
      return;
    }
    String[] resources = request.getResources();
    if (resources == null || resources.length == 0) {
      request.deny();
      return;
    }

    boolean containsAudio = false;
    for (String resource : resources) {
      if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
        containsAudio = true;
        break;
      }
    }

    if (containsAudio) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        request.grant(resources);
      } else {
        pendingPermissionRequest = request;
        ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.RECORD_AUDIO }, AUDIO_PERMISSION_REQUEST);
      }
    } else {
      request.grant(resources);
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == AUDIO_PERMISSION_REQUEST && pendingPermissionRequest != null) {
      if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
        pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
      } else {
        pendingPermissionRequest.deny();
      }
      pendingPermissionRequest = null;
    }
  }

  @Override
  public void onResume() {
    super.onResume();
    if (bridgeWebView == null) {
      return;
    }
    if (!isConnected()) {
      showOfflineOverlay();
      return;
    }
    hideOfflineOverlay();
    String currentUrl = bridgeWebView.getUrl();
    if (hasText(currentUrl) && !isAboutBlank(currentUrl)) {
      captureAppHostFromUrl(currentUrl);
      if (isAppUrl(currentUrl)) {
        updateLastKnownUrl(currentUrl);
      }
    }
    if (!hasText(currentUrl) || isAboutBlank(currentUrl) || lastLoadHadError) {
      triggerInitialLoad();
    } else {
      ensureInitialUrl();
    }
  }

  @Override
  public void onPause() {
    super.onPause();
    persistWebSession();
  }

  @Override
  public void onStop() {
    super.onStop();
    persistWebSession();
  }

  @Override
  public void onTrimMemory(int level) {
    super.onTrimMemory(level);
    if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
      persistWebSession();
    }
  }

  @Override
  public void onDestroy() {
    persistWebSession();
    unregisterConnectivityWatcher();
    if (onboardingController != null) {
      onboardingController.destroy();
      onboardingController = null;
    }
    super.onDestroy();
  }

  private void registerConnectivityWatcher() {
    if (networkCallback != null) {
      return;
    }
    ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
    if (cm == null) {
      Log.w(LOG_TAG, "ConnectivityManager unavailable for watcher");
      return;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      networkCallback =
        new ConnectivityManager.NetworkCallback() {
          @Override
          public void onCapabilitiesChanged(@NonNull Network network, @NonNull NetworkCapabilities capabilities) {
            boolean validated = capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            Log.d(LOG_TAG, "NetworkCallback onCapabilitiesChanged validated=" + validated);
            updateConnectivityState(validated);
          }

          @Override
          public void onAvailable(@NonNull Network network) {
            Log.d(LOG_TAG, "NetworkCallback onAvailable");
            boolean validated = hasValidatedInternet(cm);
            updateConnectivityState(validated);
          }

          @Override
          public void onLost(@NonNull Network network) {
            Log.d(LOG_TAG, "NetworkCallback onLost");
            updateConnectivityState(false);
          }
        };
      cm.registerDefaultNetworkCallback(networkCallback);
      updateConnectivityState(hasValidatedInternet(cm));
    } else {
      NetworkRequest request =
        new NetworkRequest.Builder()
          .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .build();
      networkCallback =
        new ConnectivityManager.NetworkCallback() {
          @Override
          public void onAvailable(@NonNull Network network) {
            Log.d(LOG_TAG, "Legacy NetworkCallback onAvailable");
            updateConnectivityState(hasValidatedInternet(cm));
          }

          @Override
          public void onLost(@NonNull Network network) {
            Log.d(LOG_TAG, "Legacy NetworkCallback onLost");
            updateConnectivityState(false);
          }
        };
      cm.registerNetworkCallback(request, networkCallback);
      updateConnectivityState(hasValidatedInternet(cm));
    }
  }

  private void unregisterConnectivityWatcher() {
    if (networkCallback == null) {
      return;
    }
    ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
    if (cm != null) {
      try {
        cm.unregisterNetworkCallback(networkCallback);
      } catch (Exception ignored) {
      }
    }
    networkCallback = null;
  }

  private void updateConnectivityState(boolean hasInternet) {
    networkHasInternet = hasInternet;
    if (!hasInternet) {
      lastLoadHadError = true;
      runOnUiThread(() -> {
        showOfflineOverlay();
        if (bridgeWebView != null) {
          try {
            bridgeWebView.stopLoading();
            bridgeWebView.loadUrl("about:blank");
          } catch (Exception ignored) {}
        }
      });
      return;
    }
    lastLoadHadError = false;
    runOnUiThread(() -> {
      hideOfflineOverlay();
      if (bridgeWebView != null) {
        String currentUrl = bridgeWebView.getUrl();
        if (!hasText(currentUrl) || isAboutBlank(currentUrl)) {
          triggerInitialLoad();
        }
      }
    });
  }

  private boolean hasValidatedInternet(ConnectivityManager cm) {
    if (cm == null) {
      return false;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Network network = cm.getActiveNetwork();
      if (network == null) {
        return false;
      }
      NetworkCapabilities capabilities = cm.getNetworkCapabilities(network);
      if (capabilities == null) {
        return false;
      }
      boolean hasTransport =
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
          || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
          || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
          || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
      if (!hasTransport) {
        return false;
      }
      return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    } else {
      NetworkInfo info = cm.getActiveNetworkInfo();
      return info != null && info.isConnected();
    }
  }

  private boolean isConnected() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && networkCallback != null) {
      return networkHasInternet;
    }
    ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
    if (cm == null) {
      Log.w(LOG_TAG, "ConnectivityManager not available");
      return false;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Network network = cm.getActiveNetwork();
      if (network == null) {
        return false;
      }
      NetworkCapabilities capabilities = cm.getNetworkCapabilities(network);
      if (capabilities == null) {
        return false;
      }
      boolean hasTransport =
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
          || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
          || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
          || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
      Log.d(LOG_TAG, "NetworkCapabilities transports?=" + hasTransport
        + " internet=" + capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        + " validated=" + capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
      if (!hasTransport) {
        return false;
      }
      return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    } else {
      NetworkInfo info = cm.getActiveNetworkInfo();
      Log.d(LOG_TAG, "Legacy activeNetworkInfo=" + (info != null ? info.isConnected() : null));
      return info != null && info.isConnected();
    }
  }

  private void persistWebSession() {
    try {
      CookieManager cookieManager = CookieManager.getInstance();
      if (cookieManager != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          cookieManager.flush();
        } else {
          try {
            android.webkit.CookieSyncManager syncManager = android.webkit.CookieSyncManager.getInstance();
            if (syncManager != null) {
              syncManager.sync();
            }
          } catch (Exception ignored) {}
        }
      }
    } catch (Exception error) {
      Log.w(LOG_TAG, "Failed to persist web session state", error);
    }
  }

  private void showOfflineOverlay() {
    Log.d(LOG_TAG, "showOfflineOverlay lastLoadHadError=" + lastLoadHadError + " view=" + (offlineOverlay != null));
    lastLoadHadError = true;
    runOnUiThread(() -> {
      if (offlineOverlay != null) {
        offlineOverlay.setVisibility(View.VISIBLE);
        offlineOverlay.bringToFront();
        offlineOverlay.invalidate();
        offlineOverlay.requestLayout();
      }
      if (swipeRefreshLayout != null) {
        swipeRefreshLayout.setRefreshing(false);
      }
      if (bridgeWebView != null) {
        bridgeWebView.setVisibility(View.GONE);
      }
      if (offlineRetryButton != null) {
        offlineRetryButton.setEnabled(true);
        offlineRetryButton.setAlpha(1f);
        if (offlineRetryOriginalText != null) {
          offlineRetryButton.setText(offlineRetryOriginalText);
        }
      }
      startOfflineAnimation();
    });
  }

  private void hideOfflineOverlay() {
    Log.d(LOG_TAG, "hideOfflineOverlay lastLoadHadError=" + lastLoadHadError + " view=" + (offlineOverlay != null));
    runOnUiThread(() -> {
      if (offlineOverlay != null) {
        offlineOverlay.setVisibility(View.GONE);
      }
      if (bridgeWebView != null) {
        bridgeWebView.setVisibility(View.VISIBLE);
      }
      if (offlineRetryButton != null) {
        offlineRetryButton.setEnabled(true);
        offlineRetryButton.setAlpha(1f);
        if (offlineRetryOriginalText != null) {
          offlineRetryButton.setText(offlineRetryOriginalText);
        }
      }
    });
  }

  private boolean hasText(String value) {
    return value != null && value.trim().length() > 0;
  }

  private boolean isAboutBlank(String value) {
    return value != null && "about:blank".equalsIgnoreCase(value.trim());
  }

  private void ensureInitialUrl() {
    if (!hasText(initialUrl) || isAboutBlank(initialUrl)) {
      String candidate = null;
      com.getcapacitor.Bridge bridge = getBridge();
      if (bridge != null) {
        try {
          candidate = bridge.getServerUrl();
        } catch (Exception ignored) {
        }
        if (!hasText(candidate) && bridge.getWebView() != null) {
          candidate = bridge.getWebView().getOriginalUrl();
          if (!hasText(candidate)) {
            candidate = bridge.getWebView().getUrl();
          }
        }
      }
      if (!hasText(candidate) && hasText(lastKnownUrl) && !isAboutBlank(lastKnownUrl)) {
        candidate = lastKnownUrl;
      }
      if (!hasText(candidate) && bridgeWebView != null) {
        candidate = bridgeWebView.getOriginalUrl();
        if (!hasText(candidate)) {
          candidate = bridgeWebView.getUrl();
        }
      }
      if (hasText(candidate) && !isAboutBlank(candidate)) {
        initialUrl = candidate;
      }
    }
    if (hasText(initialUrl)) {
      captureAppHostFromUrl(initialUrl);
    }
  }

  private boolean isNetworkError(int errorCode) {
    switch (errorCode) {
      case WebViewClient.ERROR_HOST_LOOKUP:
      case WebViewClient.ERROR_CONNECT:
      case WebViewClient.ERROR_TIMEOUT:
      case WebViewClient.ERROR_UNKNOWN:
      case WebViewClient.ERROR_FAILED_SSL_HANDSHAKE:
      case WebViewClient.ERROR_PROXY_AUTHENTICATION:
      case WebViewClient.ERROR_BAD_URL:
      case WebViewClient.ERROR_FILE:
      case WebViewClient.ERROR_FILE_NOT_FOUND:
      case WebViewClient.ERROR_TOO_MANY_REQUESTS:
        return true;
      default:
        return false;
    }
  }

  private void captureInitialUrlFromPage(String url) {
    if (!hasText(url) || isAboutBlank(url)) {
      return;
    }
    captureAppHostFromUrl(url);
    if (!isAppUrl(url)) {
      return;
    }
    if (!hasText(initialUrl) || isAboutBlank(initialUrl)) {
      initialUrl = url;
    }
    updateLastKnownUrl(url);
  }

  private void updateLastKnownUrl(String url) {
    if (!hasText(url) || isAboutBlank(url)) {
      return;
    }
    if (!isAppUrl(url) || !shouldPersistUrl(url)) {
      return;
    }
    String normalized = url.trim();
    if (hasText(lastKnownUrl) && lastKnownUrl.equals(normalized)) {
      return;
    }
    lastKnownUrl = normalized;
    if (sessionPreferences != null) {
      sessionPreferences.edit().putString(PREF_LAST_URL, lastKnownUrl).apply();
    }
  }

  private boolean shouldPersistUrl(String url) {
    try {
      Uri uri = Uri.parse(url);
      String path = uri != null ? uri.getPath() : null;
      if (!hasText(path)) {
        return true;
      }
      String normalized = path.toLowerCase();
      if (normalized.contains("sign-in") || normalized.contains("login")) {
        return false;
      }
      if (normalized.contains("sign-out") || normalized.contains("logout")) {
        return false;
      }
      if (normalized.contains("forgot-password") || normalized.contains("reset-password")) {
        return false;
      }
      return true;
    } catch (Exception ignored) {
      return true;
    }
  }

  private void captureAppHostFromUrl(String url) {
    if (!hasText(url) || isAboutBlank(url)) {
      return;
    }
    try {
      String candidate = url.trim();
      if (!candidate.contains("://")) {
        candidate = "https://" + candidate;
      }
      Uri uri = Uri.parse(candidate);
      String host = uri != null ? uri.getHost() : null;
      if (!hasText(host)) {
        return;
      }
      String normalized = host.trim().toLowerCase();
      if (hasText(appHost)) {
        if (normalized.equals(appHost)) {
          return;
        }
        if (normalized.endsWith("." + appHost)) {
          return;
        }
        if (!appHost.endsWith("." + normalized)) {
          return;
        }
      }
      appHost = normalized;
      if (sessionPreferences != null) {
        sessionPreferences.edit().putString(PREF_APP_HOST, normalized).apply();
      }
    } catch (Exception ignored) {
    }
  }

  private boolean isAppUrl(String url) {
    if (!hasText(url) || isAboutBlank(url)) {
      return false;
    }
    if (!hasText(appHost)) {
      return true;
    }
    try {
      Uri uri = Uri.parse(url);
      String host = uri != null ? uri.getHost() : null;
      if (!hasText(host)) {
        return false;
      }
      String normalized = host.trim().toLowerCase();
      return normalized.equals(appHost) || normalized.endsWith("." + appHost);
    } catch (Exception ignored) {
      return false;
    }
  }

  private void triggerInitialLoad() {
    if (bridgeWebView == null) {
      return;
    }
    if (!isConnected()) {
      showOfflineOverlay();
      return;
    }
    ensureInitialUrl();
    lastLoadHadError = false;
    hideOfflineOverlay();
    bridgeWebView.setVisibility(View.VISIBLE);
    String target = null;
    if (hasText(lastKnownUrl) && !isAboutBlank(lastKnownUrl)) {
      target = lastKnownUrl;
    }
    if (!hasText(target) || isAboutBlank(target)) {
      target = initialUrl;
    }
    if (!hasText(target) || isAboutBlank(target)) {
      target = bridgeWebView.getOriginalUrl();
    }
    if (!hasText(target) || isAboutBlank(target)) {
      target = bridgeWebView.getUrl();
    }
    if (hasText(target) && !isAboutBlank(target)) {
      captureAppHostFromUrl(target);
      bridgeWebView.loadUrl(target);
    } else {
      bridgeWebView.reload();
    }
    if (swipeRefreshLayout != null && !swipeRefreshLayout.isRefreshing()) {
      swipeRefreshLayout.setRefreshing(true);
    }
  }

  private void startOfflineAnimation() {
    if (offlineGifView == null) {
      return;
    }
    if (offlineGifView instanceof com.botadmin.shop.ui.GifImageView) {
      offlineGifView.invalidate();
      return;
    }
    if (!(offlineGifView instanceof android.widget.ImageView)) {
      return;
    }
    android.widget.ImageView imageView = (android.widget.ImageView) offlineGifView;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && imageView.getDrawable() instanceof AnimatedImageDrawable) {
        ((AnimatedImageDrawable) imageView.getDrawable()).start();
        return;
      }
      if (imageView.getDrawable() instanceof Animatable) {
        ((Animatable) imageView.getDrawable()).start();
      }
    } catch (Exception ignored) {
      if (imageView.getDrawable() instanceof Animatable) {
        ((Animatable) imageView.getDrawable()).start();
      }
    }
  }
}

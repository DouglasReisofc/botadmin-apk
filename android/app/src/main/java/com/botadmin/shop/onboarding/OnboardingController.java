package com.botadmin.shop.onboarding;

import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;

import androidx.annotation.Nullable;
import androidx.viewpager2.widget.ViewPager2;

import com.botadmin.shop.BuildConfig;
import com.botadmin.shop.MainActivity;
import com.botadmin.shop.R;
import com.getcapacitor.Bridge;
import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class OnboardingController {
    private static final String TAG = "OnboardingController";
    private static final String PREFS_NAME = "storebot_onboarding";
    private static final String PREF_KEY_REVISION = "seen_revision";

    private final MainActivity activity;
    private final Bridge bridge;
    private final View overlay;
    private final ViewPager2 pager;
    private final LinearLayout indicatorContainer;
    private final MaterialButton nextButton;
    private final MaterialButton skipButton;
    private final OnboardingAdapter adapter;
    private final SharedPreferences preferences;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    
    private String payloadRevision;
    private List<OnboardingSlide> currentSlides = new ArrayList<>();

    public OnboardingController(MainActivity activity, Bridge bridge) {
        this.activity = activity;
        this.bridge = bridge;

        View foundOverlay = activity.findViewById(R.id.onboarding_container);
        if (foundOverlay == null) {
            try {
                android.view.ViewGroup root = activity.findViewById(android.R.id.content);
                if (root != null) {
                    View inflated = LayoutInflater.from(activity).inflate(R.layout.view_onboarding_overlay, root, false);
                    inflated.setId(R.id.onboarding_container);
                    root.addView(inflated);
                    foundOverlay = inflated;
                }
            } catch (Exception error) {
                Log.w(TAG, "Failed to inflate onboarding overlay dynamically", error);
            }
        }

        this.overlay = foundOverlay;
        this.pager = overlay != null ? overlay.findViewById(R.id.onboarding_pager) : null;
        this.indicatorContainer = overlay != null ? overlay.findViewById(R.id.onboarding_indicator) : null;
        this.nextButton = overlay != null ? overlay.findViewById(R.id.onboarding_button_next) : null;
        this.skipButton = overlay != null ? overlay.findViewById(R.id.onboarding_button_skip) : null;
        this.adapter = new OnboardingAdapter();
        this.preferences = activity.getSharedPreferences(PREFS_NAME, MainActivity.MODE_PRIVATE);

        if (pager != null) {
            pager.setAdapter(adapter);
            pager.registerOnPageChangeCallback(new ViewPager2.OnPageChangeCallback() {
                @Override
                public void onPageSelected(int position) {
                    super.onPageSelected(position);
                    updateNextButton(position);
                    updateIndicators(position);
                }
            });
        }

        if (skipButton != null) {
            skipButton.setOnClickListener(v -> completeOnboarding());
        }
        if (nextButton != null) {
            nextButton.setOnClickListener(v -> handleNext());
        }

        if (overlay != null) {
            overlay.setVisibility(View.GONE);
        }
    }

    public void start() {
        if (overlay == null || pager == null || indicatorContainer == null || nextButton == null) {
            return;
        }

        OnboardingPayload local = loadLocalPayload();
        if (local != null) {
            Log.d(TAG, "Loaded local onboarding payload (" + local.slides.size() + " slides)");
            applyPayload(local);
        } else {
            Log.w(TAG, "No local onboarding payload found");
        }

        final String baseUrl = resolveBaseUrl();
        if (!TextUtils.isEmpty(baseUrl)) {
            executor.execute(() -> {
                OnboardingPayload payload = fetchPayload(baseUrl + "/api/mobile/onboarding");
                if (payload != null) {
                    Log.d(TAG, "Fetched remote onboarding payload (" + payload.slides.size() + " slides)");
                    mainHandler.post(() -> applyPayload(payload));
                } else if (local == null) {
                    runOnMainThread(this::hideOverlay);
                }
            });
        } else if (local == null) {
            hideOverlay();
        }
    }

    public void destroy() {
        executor.shutdownNow();
    }

    private void applyPayload(OnboardingPayload payload) {
        if (!payload.enabled || payload.slides.isEmpty()) {
            hideOverlay();
            return;
        }

        this.currentSlides = payload.slides;
        this.payloadRevision = !TextUtils.isEmpty(payload.revision)
            ? payload.revision
            : String.valueOf(payload.slides.hashCode());

        String lastSeen = preferences.getString(PREF_KEY_REVISION, "");
        if (!TextUtils.isEmpty(lastSeen) && TextUtils.equals(lastSeen, payloadRevision)) {
            Log.d(TAG, "Skipping onboarding; revision already seen: " + payloadRevision);
            hideOverlay();
            return;
        }

        adapter.submitSlides(payload.slides);

        indicatorContainer.setVisibility(currentSlides.size() > 1 ? View.VISIBLE : View.GONE);
        if (currentSlides.size() > 1) {
            configureIndicators();
            updateIndicators(0);
        }

        pager.setCurrentItem(0, false);
        updateNextButton(0);
        if (overlay != null) {
            overlay.setVisibility(View.VISIBLE);
        }
    }

    private void handleNext() {
        if (currentSlides.isEmpty()) {
            completeOnboarding();
            return;
        }
        int position = pager.getCurrentItem();
        if (position >= currentSlides.size() - 1) {
            completeOnboarding();
        } else {
            pager.setCurrentItem(position + 1, true);
        }
    }

    private void updateNextButton(int position) {
        if (nextButton == null || currentSlides.isEmpty()) {
            return;
        }
        if (position < 0 || position >= currentSlides.size()) {
            position = currentSlides.size() - 1;
        }
        OnboardingSlide slide = currentSlides.get(position);
        String label = slide.getButtonLabel();
        if (TextUtils.isEmpty(label)) {
            label = position >= currentSlides.size() - 1 ? "Começar" : "Próximo";
        }
        nextButton.setText(label);
    }

    private void configureIndicators() {
        if (indicatorContainer == null || pager == null) {
            return;
        }
        indicatorContainer.removeAllViews();
        if (currentSlides.size() <= 1) {
            return;
        }
        LayoutInflater inflater = LayoutInflater.from(activity);
        for (int i = 0; i < currentSlides.size(); i++) {
            View dot = createIndicatorView(inflater, i == pager.getCurrentItem());
            indicatorContainer.addView(dot);
        }
    }

    private void updateIndicators(int position) {
        if (indicatorContainer == null) {
            return;
        }
        int count = indicatorContainer.getChildCount();
        if (count <= 1) {
            return;
        }
        for (int i = 0; i < count; i++) {
            View child = indicatorContainer.getChildAt(i);
            if (child == null) {
                continue;
            }
            View dot = child.findViewById(R.id.onboarding_indicator_dot);
            if (dot != null) {
                dot.setBackgroundResource(i == position
                    ? R.drawable.bg_onboarding_dot_active
                    : R.drawable.bg_onboarding_dot_inactive);
            }
        }
    }

    private View createIndicatorView(LayoutInflater inflater, boolean selected) {
        View view = inflater.inflate(R.layout.view_onboarding_indicator_dot, indicatorContainer, false);
        View dot = view.findViewById(R.id.onboarding_indicator_dot);
        if (dot != null) {
            dot.setBackgroundResource(selected
                ? R.drawable.bg_onboarding_dot_active
                : R.drawable.bg_onboarding_dot_inactive);
        }
        return view;
    }

    private void completeOnboarding() {
        if (overlay != null) {
            overlay.setVisibility(View.GONE);
        }
        preferences.edit().putString(PREF_KEY_REVISION, payloadRevision != null ? payloadRevision : "").apply();
        if (indicatorContainer != null) {
            indicatorContainer.removeAllViews();
        }
        currentSlides = new ArrayList<>();
    }

    private void hideOverlay() {
        if (overlay != null) {
            overlay.setVisibility(View.GONE);
        }
    }

    private void runOnMainThread(Runnable task) {
        if (task == null) {
            return;
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            task.run();
        } else {
            mainHandler.post(task);
        }
    }

    @Nullable
    private String resolveBaseUrl() {
        if (bridge != null) {
            String serverUrl = bridge.getServerUrl();
            if (!TextUtils.isEmpty(serverUrl)) {
                if (serverUrl.endsWith("/")) {
                    return serverUrl.substring(0, serverUrl.length() - 1);
                }
                return serverUrl;
            }
        }
        return sanitizeBaseUrl(BuildConfig.ONBOARDING_BASE_URL);
    }

    @Nullable
    private OnboardingPayload loadLocalPayload() {
        InputStream stream = null;
        try {
            stream = activity.getAssets().open("onboarding.json");
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
            JSONObject root = new JSONObject(builder.toString());
            boolean enabled = root.optBoolean("enabled", false);
            String revision = root.optString("revision", null);
            JSONArray slidesArray = root.optJSONArray("slides");
            List<OnboardingSlide> slides = new ArrayList<>();
            if (slidesArray != null) {
                for (int i = 0; i < slidesArray.length(); i++) {
                    JSONObject item = slidesArray.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id", "slide-" + i);
                    String title = item.optString("title", "").trim();
                    String description = item.optString("description", "").trim();
                    if (title.isEmpty() || description.isEmpty()) continue;
                    String buttonLabel = item.optString("buttonLabel", "");
                    String imageUrl = item.optString("imageUrl", null);
                    if (TextUtils.isEmpty(imageUrl)) imageUrl = null;
                    slides.add(new OnboardingSlide(id, title, description, buttonLabel, imageUrl));
                }
            }
            return new OnboardingPayload(enabled, revision, slides);
        } catch (Exception error) {
            Log.w(TAG, "Failed to load local onboarding.json", error);
            return null;
        } finally {
            if (stream != null) {
                try { stream.close(); } catch (Exception ignored) {}
            }
        }
    }

    @Nullable
    private String sanitizeBaseUrl(@Nullable String input) {
        if (TextUtils.isEmpty(input)) {
            return null;
        }
        String trimmed = input.trim();
        if (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        try {
            URL parsed = new URL(trimmed);
            String protocol = parsed.getProtocol();
            if (!"http".equalsIgnoreCase(protocol) && !"https".equalsIgnoreCase(protocol)) {
                return null;
            }
            return parsed.toString();
        } catch (MalformedURLException ignored) {
            return null;
        }
    }

    @Nullable
    private OnboardingPayload fetchPayload(String endpoint) {
        HttpURLConnection connection = null;
        InputStream stream = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.connect();

            int status = connection.getResponseCode();
            stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            if (stream == null) {
                runOnMainThread(this::hideOverlay);
                return null;
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }

            if (status < 200 || status >= 300) {
                runOnMainThread(this::hideOverlay);
                return null;
            }

            JSONObject root = new JSONObject(builder.toString());
            boolean enabled = root.optBoolean("enabled", false);
            String revision = root.optString("revision", null);
            JSONArray slidesArray = root.optJSONArray("slides");
            List<OnboardingSlide> slides = new ArrayList<>();

            if (slidesArray != null) {
                for (int i = 0; i < slidesArray.length(); i++) {
                    JSONObject item = slidesArray.optJSONObject(i);
                    if (item == null) {
                        continue;
                    }
                    String id = item.optString("id", "slide-" + i);
                    String title = item.optString("title", "").trim();
                    String description = item.optString("description", "").trim();
                    if (title.isEmpty() || description.isEmpty()) {
                        continue;
                    }
                    String buttonLabel = item.optString("buttonLabel", "");
                    String imageUrl = item.optString("imageUrl", null);
                    if (TextUtils.isEmpty(imageUrl)) {
                        imageUrl = null;
                    }
                    slides.add(new OnboardingSlide(id, title, description, buttonLabel, imageUrl));
                }
            }

            return new OnboardingPayload(enabled, revision, slides);
        } catch (Exception error) {
            Log.w(TAG, "Failed to fetch onboarding payload", error);
            runOnMainThread(this::hideOverlay);
            return null;
        } finally {
            if (stream != null) {
                try {
                    stream.close();
                } catch (Exception ignored) {
                }
            }
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static class OnboardingPayload {
        final boolean enabled;
        final String revision;
        final List<OnboardingSlide> slides;

        OnboardingPayload(boolean enabled, String revision, List<OnboardingSlide> slides) {
            this.enabled = enabled;
            this.revision = revision;
            this.slides = slides != null ? slides : new ArrayList<>();
        }
    }
}

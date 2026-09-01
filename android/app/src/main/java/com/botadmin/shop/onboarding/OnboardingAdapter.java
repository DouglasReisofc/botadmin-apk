package com.botadmin.shop.onboarding;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.botadmin.shop.R;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class OnboardingAdapter extends RecyclerView.Adapter<OnboardingAdapter.SlideViewHolder> {
    private final List<OnboardingSlide> slides = new ArrayList<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @NonNull
    @Override
    public SlideViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_onboarding_slide, parent, false);
        return new SlideViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull SlideViewHolder holder, int position) {
        OnboardingSlide slide = slides.get(position);
        holder.title.setText(slide.getTitle());
        holder.description.setText(slide.getDescription());

        String imageUrl = slide.getImageUrl();
        if (TextUtils.isEmpty(imageUrl)) {
            holder.image.setVisibility(View.GONE);
            holder.image.setImageDrawable(null);
            holder.image.setTag(null);
        } else {
            holder.image.setVisibility(View.INVISIBLE);
            holder.image.setImageDrawable(null);
            holder.image.setTag(imageUrl);
            loadImageAsync(holder.image, imageUrl);
        }
    }

    @Override
    public int getItemCount() {
        return slides.size();
    }

    public void submitSlides(List<OnboardingSlide> items) {
        slides.clear();
        if (items != null) {
            slides.addAll(items);
        }
        notifyDataSetChanged();
    }

    private void loadImageAsync(ImageView target, String url) {
        executor.submit(() -> {
            HttpURLConnection connection = null;
            InputStream stream = null;
            try {
                if (url != null && url.startsWith("file:///android_asset/")) {
                    String assetPath = url.replace("file:///android_asset/", "");
                    stream = target.getContext().getAssets().open(assetPath);
                } else {
                    URL remote = new URL(url);
                    connection = (HttpURLConnection) remote.openConnection();
                    connection.setConnectTimeout(6000);
                    connection.setReadTimeout(6000);
                    connection.setInstanceFollowRedirects(true);
                    connection.connect();
                    stream = connection.getInputStream();
                }
                final Bitmap bitmap = BitmapFactory.decodeStream(stream);
                target.post(() -> {
                    Object tag = target.getTag();
                    if (bitmap != null && tag instanceof String && TextUtils.equals((String) tag, url)) {
                        target.setImageBitmap(bitmap);
                        target.setVisibility(View.VISIBLE);
                    } else if (!(tag instanceof String) || !TextUtils.equals((String) tag, url)) {
                        target.setVisibility(View.GONE);
                    }
                });
            } catch (Exception ignored) {
                target.post(() -> target.setVisibility(View.GONE));
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
        });
    }

    static class SlideViewHolder extends RecyclerView.ViewHolder {
        final ImageView image;
        final TextView title;
        final TextView description;

        SlideViewHolder(@NonNull View itemView) {
            super(itemView);
            image = itemView.findViewById(R.id.onboarding_slide_image);
            title = itemView.findViewById(R.id.onboarding_slide_title);
            description = itemView.findViewById(R.id.onboarding_slide_description);
        }
    }
}

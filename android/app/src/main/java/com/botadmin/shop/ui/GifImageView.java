package com.botadmin.shop.ui;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Canvas;
import android.graphics.Movie;
import android.util.AttributeSet;
import android.view.View;

import androidx.annotation.DrawableRes;
import androidx.annotation.Nullable;

import com.botadmin.shop.R;

import java.io.InputStream;

public class GifImageView extends View {
  private Movie movie;
  private long movieStart = 0L;
  private int intrinsicWidth = 1;
  private int intrinsicHeight = 1;

  public GifImageView(Context context) {
    super(context);
  }

  public GifImageView(Context context, @Nullable AttributeSet attrs) {
    super(context, attrs);
    init(context, attrs);
  }

  public GifImageView(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
    super(context, attrs, defStyleAttr);
    init(context, attrs);
  }

  private void init(Context context, @Nullable AttributeSet attrs) {
    if (attrs == null) {
      return;
    }
    TypedArray a = context.obtainStyledAttributes(attrs, R.styleable.GifImageView);
    int resId = a.getResourceId(R.styleable.GifImageView_gifSrc, 0);
    a.recycle();
    if (resId != 0) {
      setGifResource(resId);
    }
  }

  public void setGifResource(@DrawableRes int resId) {
    try {
      InputStream stream = getResources().openRawResource(resId);
      movie = Movie.decodeStream(stream);
      if (movie != null) {
        intrinsicWidth = movie.width();
        intrinsicHeight = movie.height();
        movieStart = 0L;
        invalidate();
      }
    } catch (Exception ignored) {
    }
  }

  @Override
  protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
    int desiredWidth = intrinsicWidth;
    int desiredHeight = intrinsicHeight;
    int widthMode = MeasureSpec.getMode(widthMeasureSpec);
    int widthSize = MeasureSpec.getSize(widthMeasureSpec);
    int heightMode = MeasureSpec.getMode(heightMeasureSpec);
    int heightSize = MeasureSpec.getSize(heightMeasureSpec);

    int width;
    int height;

    if (widthMode == MeasureSpec.EXACTLY) {
      width = widthSize;
    } else if (widthMode == MeasureSpec.AT_MOST) {
      width = Math.min(desiredWidth, widthSize);
    } else {
      width = desiredWidth;
    }

    if (heightMode == MeasureSpec.EXACTLY) {
      height = heightSize;
    } else if (heightMode == MeasureSpec.AT_MOST) {
      height = Math.min(desiredHeight, heightSize);
    } else {
      height = desiredHeight;
    }

    setMeasuredDimension(width, height);
  }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    if (movie == null) {
      return;
    }
    long now = android.os.SystemClock.uptimeMillis();
    if (movieStart == 0L) {
      movieStart = now;
    }
    int duration = movie.duration();
    if (duration == 0) duration = 1000;
    int relTime = (int) ((now - movieStart) % duration);
    movie.setTime(relTime);

    float scaleX = getWidth() / (float) intrinsicWidth;
    float scaleY = getHeight() / (float) intrinsicHeight;
    canvas.save();
    canvas.scale(scaleX, scaleY);
    movie.draw(canvas, 0, 0);
    canvas.restore();

    invalidate();
  }
}

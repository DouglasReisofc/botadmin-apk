package com.botadmin.shop;

import android.app.Application;

import com.botadmin.shop.notifications.NotificationUtils;

public class StoreBotApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        NotificationUtils.ensureChannel(
                this,
                NotificationUtils.DEFAULT_CHANNEL_ID,
                NotificationUtils.DEFAULT_SOUND_NAME
        );
    }
}

package com.botadmin.shop.onboarding;

public class OnboardingSlide {
    private final String id;
    private final String title;
    private final String description;
    private final String buttonLabel;
    private final String imageUrl;

    public OnboardingSlide(String id, String title, String description, String buttonLabel, String imageUrl) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.buttonLabel = buttonLabel;
        this.imageUrl = imageUrl;
    }

    public String getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public String getButtonLabel() {
        return buttonLabel;
    }

    public String getImageUrl() {
        return imageUrl;
    }
}

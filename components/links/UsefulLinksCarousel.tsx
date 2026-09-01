"use client";

import Image from "next/image";
import { Carousel } from "react-bootstrap";

import type { UsefulLinkBanner } from "types/useful-links";
import styles from "./useful-links.module.scss";

type UsefulLinksCarouselProps = {
  banners: UsefulLinkBanner[];
  className?: string;
};

const UsefulLinksCarousel = ({ banners, className }: UsefulLinksCarouselProps) => {
  if (!Array.isArray(banners) || banners.length === 0) {
    return null;
  }

  const carouselClassName = [
    styles.bannerCarouselBase,
    className ?? "",
  ]
    .join(" ")
    .trim();

  return (
    <Carousel className={carouselClassName}>
      {banners.map((banner) => {
        const visual = (
          <div className={styles.bannerSlide}>
            <div className={styles.bannerImageWrapper}>
              <Image
                src={banner.mediaUrl}
                alt={banner.title}
                fill
                sizes="(max-width: 992px) 100vw, 340px"
                className={styles.bannerImage}
                priority={false}
                unoptimized
              />
            </div>
            {(banner.title || banner.subtitle) && (
              <div className={styles.bannerCaption}>
                {banner.title ? (
                  <h3 className={styles.bannerCaptionTitle}>{banner.title}</h3>
                ) : null}
                {banner.subtitle ? (
                  <p className={styles.bannerCaptionSubtitle}>{banner.subtitle}</p>
                ) : null}
              </div>
            )}
          </div>
        );

        const slideContent = banner.linkUrl ? (
          <a
            href={banner.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.bannerSlideLink}
          >
            {visual}
          </a>
        ) : (
          visual
        );

        return (
          <Carousel.Item key={banner.id}>
            {slideContent}
          </Carousel.Item>
        );
      })}
    </Carousel>
  );
};

export default UsefulLinksCarousel;

"use client";
//import node modules libraries
import { useRef } from "react";
import { Button, Card, CardBody, Image, Row, Col } from "react-bootstrap";
import { Swiper, SwiperRef, SwiperSlide } from "swiper/react";
import { Navigation, Pagination, Autoplay } from "swiper/modules";

//import required data files
import { EventList } from "data/DashboardData";
import { getAssetPath } from "helper/assetPath";

const UpcomingMeetingSlider = () => {
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const swiperRef = useRef<SwiperRef>(null);

  return (
    <Card className="card-lg mb-6">
      <CardBody>
        <div className="mb-4 position-relative py-2">
          <div>
            <h5 className="mb-1">Upcoming Meetings</h5>
          </div>

          <div className="swiper-navigation position-absolute top-50 end-10 me-4 me-lg-8 me-xl-4">
            <div
              ref={prevRef}
              onClick={() => swiperRef?.current?.swiper.slidePrev()}
              className="swiper-button-prev ms-n4"
              style={{ cursor: "pointer" }}
            />
            <div
              ref={nextRef}
              onClick={() => swiperRef?.current?.swiper.slideNext()}
              className="swiper-button-next ms-5"
              style={{ cursor: "pointer" }}
            />
          </div>
        </div>

        <Row>
          <Col>
            <Swiper
              ref={swiperRef}
              modules={[Navigation, Pagination, Autoplay]}
              // onSwiper={(swiper) => {
              //   swiperRef.current = swiper;
              // }}
              speed={900}
              spaceBetween={100}
              navigation={{
                prevEl: prevRef.current,
                nextEl: nextRef.current,
              }}
              onInit={(swiper) => {
                if (
                  swiper.params.navigation &&
                  typeof swiper.params.navigation === "object"
                ) {
                  (
                    swiper.params.navigation as {
                      prevEl?: HTMLElement | null;
                      nextEl?: HTMLElement | null;
                    }
                  ).prevEl = prevRef.current;
                  (
                    swiper.params.navigation as {
                      prevEl?: HTMLElement | null;
                      nextEl?: HTMLElement | null;
                    }
                  ).nextEl = nextRef.current;
                }
                swiper.navigation.init();
                swiper.navigation.update();
              }}
              pagination={false}
              autoplay={false}
              breakpoints={{
                480: { slidesPerView: 1 },
                768: { slidesPerView: 1 },
                1024: { slidesPerView: 1 },
                1200: { slidesPerView: 1 },
              }}
              className="blog-swiper"
            >
              {EventList.map((item, index) => (
                <SwiperSlide key={index}>
                  <Card className="border">
                    <CardBody>
                      <div>
                        <h4>{item.title}</h4>
                        <div className="d-flex align-items-center gap-3 text-secondary">
                          <span>{item.date}</span>
                          <span>{item.time}</span>
                        </div>

                        <div className="d-flex align-items-center gap-2 text-secondary mt-4">
                          <Image src={getAssetPath("/images/svg/zoom.svg")} alt="" />
                          <span>Zoom</span>
                        </div>
                      </div>
                      <div className="d-grid mt-4">
                        <Button href="#!" variant="primary">
                          Join
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                </SwiperSlide>
              ))}
            </Swiper>
          </Col>
        </Row>
      </CardBody>
    </Card>
  );
};

export default UpcomingMeetingSlider;

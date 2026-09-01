//import node modules libraries
import { Fragment } from "react";
import Link from "next/link";
import { Row, Col, Image } from "react-bootstrap";
import {
  IconClock,
  IconDeviceDesktop,
  IconLifebuoy,
} from "@tabler/icons-react";
import { Metadata } from "next";
import { getAssetPath } from "helper/assetPath";


export const metadata: Metadata = {
  title: "Maintenance | Dasher - Responsive Bootstrap 5 Admin Dashboard",
  description: "Dasher - Responsive Bootstrap 5 Admin Dashboard",
};

const Maintenance = () => {
  return (
    <Fragment>
      <Row className="text-center">
        <Col>
          <div>
            <h1>Site is Under Maintenance</h1>
            <p>
              We&apos;re making the system more awesome. We&apos;ll be back
              shortly.
            </p>
          </div>
          <div>
            <Image
              src={getAssetPath("/images/svg/maintenance.svg")}
              alt="Image"
              style={{ width: "500px" }}
            />
          </div>
        </Col>
      </Row>
      <Row>
        <Col xl={{ span: 10, offset: 1 }}>
          <Row>
            <Col md={4}>
              <div className="mb-4 mb-lg-0">
                <div className="d-flex flex-column gap-4">
                  <div className="text-primary">
                    <IconDeviceDesktop size={40} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="fs-5">Why is the site down?</h3>
                    <p className="mb-0">
                      it can be due to an error with your DNS settings, hosting
                      provider, or web applications.
                    </p>
                  </div>
                </div>
              </div>
            </Col>
            <Col md={4}>
              <div className="mb-4 mb-lg-0">
                <div className="d-flex flex-column gap-4">
                  <div className="text-primary">
                    <IconClock size={40} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="fs-5">What is downtime?</h3>
                    <p className="mb-0">
                      A machine is not operating or being productive due to
                      required maintenance work.
                    </p>
                  </div>
                </div>
              </div>
            </Col>
            <Col md={4}>
              <div className="mb-4 mb-lg-0">
                <div className="d-flex flex-column gap-4">
                  <div className="text-primary">
                    <IconLifebuoy size={40} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="fs-5">Do you need support?</h3>
                    <p>
                      In emergrancy, our team will help you. Just drop a message
                      to the
                    </p>
                    <Link href="#!" className="text-inherit">
                      Dasher@example.com
                    </Link>
                  </div>
                </div>
              </div>
            </Col>
          </Row>
        </Col>
      </Row>
    </Fragment>
  );
};

export default Maintenance;

"use client";
//import node modules libraries
import { Row, Col, Nav, Tab, Badge } from "react-bootstrap";

//import custom components
import PublishedBlogList from "./PublishedBlogList";
import DraftsBlogList from "./DraftsBlogList";
import ScheduledBlogList from "./ScheduledBlogList";

const BlogList = () => {
  return (
    <Row>
      <Col lg={12}>
        <Tab.Container defaultActiveKey={"0"}>
          <Nav
            className="nav-lb-tab border-dashed border-bottom mb-6"
            id="pills-tab"
            defaultActiveKey={"0"}
          >
            <Nav.Item>
              <Nav.Link href="" eventKey={"0"}>
                <div className="d-flex align-items-center gap-2 lh-1">
                  <span>
                    Published
                    <Badge
                      bg="gray-200"
                      text="gray-600"
                      className="rounded-circle"
                    >
                      12
                    </Badge>
                  </span>
                </div>
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link href="" eventKey={"1"}>
                <div className="d-flex align-items-center gap-2 lh-1">
                  <span>
                    Drafts
                    <Badge
                      bg="gray-200"
                      text="gray-600"
                      className="rounded-circle"
                    >
                      3
                    </Badge>
                  </span>
                </div>
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link href="" eventKey={"2"}>
                <div className="d-flex align-items-center gap-2 lh-1">
                  <span>
                    Scheduled
                    <Badge
                      bg="gray-200"
                      text="gray-600"
                      className="rounded-circle"
                    >
                      2
                    </Badge>
                  </span>
                </div>
              </Nav.Link>
            </Nav.Item>
          </Nav>

          <Tab.Content id="pills-tabContent">
            <Tab.Pane eventKey={"0"}>
              <PublishedBlogList />
            </Tab.Pane>
            <Tab.Pane eventKey={"1"}>
              <DraftsBlogList />
            </Tab.Pane>
            <Tab.Pane eventKey={"2"}>
              <ScheduledBlogList />
            </Tab.Pane>
          </Tab.Content>
        </Tab.Container>
      </Col>
    </Row>
  );
};

export default BlogList;

"use client";
//import node modules libraries
import { Row, Col, Card, Form } from "react-bootstrap";

//import custom components
import TanstackTable from "components/table/TanstackTable";
import { blogListColumns } from "./ColumnDifinitions";

//import required data files
import { blogListData } from "data/BlogData";

const DraftsBlogList = () => {
  // Filter data based on the status
  const draftBlog = blogListData.filter(
    (item) => item.post_status === "Drafts"
  );

  return (
    <Card className="card-lg" id="publishedList">
      <Card.Header className="border-bottom-0">
        <Row className="justify-content-between gy-2">
          <Col lg={4}>
            <Form.Control
              type="search"
              className="listjs-search"
              placeholder="Search"
            />
          </Col>
          <Col lg={2}>
            <Form.Select>
              <option defaultValue="">Status</option>
              <option value="Latest">Latest</option>
              <option value="Popular">Popular</option>
              <option value="Oldest">Oldest</option>
            </Form.Select>
          </Col>
        </Row>
      </Card.Header>
      <TanstackTable data={draftBlog} columns={blogListColumns} pagination />
    </Card>
  );
};

export default DraftsBlogList;

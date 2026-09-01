//import node modules libraries
import { Row, Col, Button } from "react-bootstrap";
import { IconPlus } from "@tabler/icons-react";

//import custom components
import Flex from "components/common/Flex";
import DasherBreadcrumb from "components/common/DasherBreadcrumb";

const BlogListHeader = () => {
  return (
    <Row>
      <Col lg={12} md={12}>
        <Flex
          className="mb-8"
          breakpoint="md"
          justifyContent="between"
          alignItems="center"
        >
          <div>
            <h1 className="mb-3 h2">List</h1>
            <DasherBreadcrumb />
          </div>
          <div>
            <Button
              href="#"
              variant="primary"
              className="d-md-flex align-items-center gap-1"
            >
              <IconPlus size={18} />
              New Post
            </Button>
          </div>
        </Flex>
      </Col>
    </Row>
  );
};

export default BlogListHeader;

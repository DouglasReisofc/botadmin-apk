//import node module libraries
import { Row, Col, Button } from "react-bootstrap";
import { IconPlus } from "@tabler/icons-react";

//import custom components
import Flex from "components/common/Flex";
import DasherBreadcrumb from "components/common/DasherBreadcrumb";

const EcommerceHeader = () => {
  return (
    <Row>
      <Col>
        <Flex
          justifyContent="between"
          alignItems="center"
          className="mb-8 w-100"
          breakpoint="md"
        >
          <div>
            <h1 className="mb-3 h2">Products</h1>
            <DasherBreadcrumb />
          </div>
          <div>
            <Button
              href="#"
              variant="dark"
              className=" d-md-flex align-items-center gap-2"
            >
              <IconPlus size={18} />
              New Product
            </Button>
          </div>
        </Flex>
      </Col>
    </Row>
  );
};

export default EcommerceHeader;

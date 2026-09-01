//import node modules libraries
import { Card, CardBody, Button } from "react-bootstrap";

const ProjectBudget = () => {
  return (
    <Card className="card-lg mb-6">
      <CardBody>
        <div className="mb-4">
          <h5 className="mb-1">Project Budget</h5>
          <span className="text-secondary">Budget Allocation Overview:</span>
        </div>
        <div className="fs-2 fw-bold mb-3">$50,000</div>
        <div className="d-flex justify-content-between align-items-center gap-1 w-100 mb-2">
          <div>Spent:</div>
          <div>$35,000</div>
        </div>
        <div className="d-flex justify-content-between align-items-center gap-1 w-100 mb-4">
          <div>Remaining:</div>
          <div>$15,000</div>
        </div>
        <div className="d-flex justify-content-between gap-3">
          <Button href="#!" variant="primary" className="w-100">
            Add Budget
          </Button>
          <Button href="#!" variant="white" className="w-100">
            View Details
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

export default ProjectBudget;

//import node modules libraries
import { Row, Col, Card, CardBody, Button } from "react-bootstrap";

//import required data files
import { teamMembers } from "data/DashboardData";

//import custom components
import { Avatar } from "components/common/Avatar";

const TeamsTable = () => {
  return (
    <Row xxl={2} xs={1}>
      <Col>
        <Card className="card-lg mb-6">
          <CardBody>
            <div className="mb-4">
              <h5 className="mb-0">Teams</h5>
            </div>
            <div className="d-flex flex-column">
              {teamMembers.map((member, index) => (
                <div
                  key={index}
                  className={`d-flex justify-content-between align-items-end py-3 ${
                    index !== teamMembers.length - 1
                      ? "border-bottom border-dashed"
                      : ""
                  }`}
                >
                  <div className="d-flex align-items-center gap-3">
                    <Avatar
                      src={member.avatar}
                      type="image"
                      size="md"
                      alt="User Avatar"
                      className="rounded-circle"
                    />

                    <div>
                      <div className="fw-semibold">{member.name}</div>
                      <div className="text-secondary">{member.role}</div>
                    </div>
                  </div>
                  <div className="text-secondary">
                    Tasks: {member.tasksAssigned} Assigned
                  </div>
                </div>
              ))}
              <div className="mt-4">
                <Button href="#!" variant="white">
                  View All Members
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
};

export default TeamsTable;

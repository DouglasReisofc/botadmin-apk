//import node modules libraries
import { IconCircleFilled } from "@tabler/icons-react";
import { Card, CardBody, Button } from "react-bootstrap";

//import require data files
import { activityLog } from "data/DashboardData";

const ActivityLog = () => {
  return (
    <Card className="card-lg mb-6">
      <CardBody>
        <div className="mb-4">
          <h5 className="mb-0">Activity Log</h5>
        </div>
        <div className="d-flex flex-column gap-5 mb-6">
          {activityLog.map((item, index) => (
            <div
              key={index}
              className="timeline-vertical timeline-vertical-height"
            >
              <div className="timeline-item position-relative">
                <div className="row g-0">
                  <div className="col">
                    <div>
                      <IconCircleFilled
                        size={12}
                        className={`text-${item.colorClass}`}
                      />
                    </div>
                    <div className="timeline-bar border-start border-dashed"></div>
                  </div>
                  <div className="col-11">
                    <div>{item.description}</div>
                    <div className="text-secondary">{item.timestamp}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div>
          <Button href="#!" variant="white">
            View Full Log
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

export default ActivityLog;

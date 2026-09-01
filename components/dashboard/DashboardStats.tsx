//import node modules libraries
import { Col, Card, CardBody } from "react-bootstrap";

//import required data files
import { DashboardStatsData } from "data/DashboardData";

const DashboardStats = () => {
  return (
    <>
      {DashboardStatsData.map((stat) => (
        <Col xl={3} md={6} key={stat.id}>
          <Card className={`card-lg ${stat.bgColor}`}>
            <CardBody className="d-flex flex-column gap-8">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="fw-semibold">{stat.title}</div>
                </div>
                <div className={`${stat.textColor}`}>{stat.icon}</div>
              </div>
              <div className="lh-1 d-flex flex-column gap-3">
                <div className="fs-1 fw-bold">{stat.value}</div>
                <p className="mb-0">
                  <span className={`me-1 ${stat.textColor}`}>
                    {stat.bottomValue}
                  </span>
                  <span className="text-secondary">{stat.description}</span>
                </p>
              </div>
            </CardBody>
          </Card>
        </Col>
      ))}
    </>
  );
};

export default DashboardStats;

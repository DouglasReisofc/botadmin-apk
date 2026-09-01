"use client";
//import node modules libraries
import { Card, CardHeader, CardFooter, Button } from "react-bootstrap";

//import custom components
import TanstackTable from "components/table/TanstackTable";
import { ActiveProjectColumns } from "components/dashboard/ColumnDefination";

//import required data files
import { activeProject } from "data/DashboardData";

const ActiveProject = () => {
  return (
    <Card className="card-lg mb-6">
      <CardHeader className="border-bottom-0">
        <h5 className="mb-0">Active Projects</h5>
      </CardHeader>
      <div>
        <TanstackTable data={activeProject} columns={ActiveProjectColumns} />
      </div>
      <CardFooter className=" border-dashed border-top text-center">
        <Button href="#!" variant="link">
          View All Projects
        </Button>
      </CardFooter>
    </Card>
  );
};

export default ActiveProject;

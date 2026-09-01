"use client";
//import node modules libraries
import { Card, CardBody, Badge, Form, Dropdown } from "react-bootstrap";
import { IconDotsVertical } from "@tabler/icons-react";

//import custom components
import ActionMenu from "components/common/ActionMenu";

//import required data files
import { tasks } from "data/DashboardData";

const TaskList = () => {
  return (
    <Card className="card-lg">
      <CardBody>
        <div className="mb-4">
          <h5 className="mb-0">My Task</h5>
        </div>
        <div style={{ height: "320px", overflowY: "auto" }}>
          {tasks.map((task) => (
            <div
              key={task.id}
              className="d-flex justify-content-between align-items-center border-bottom border-dashed py-3 px-2"
            >
              <div className="d-flex align-items-center gap-3">
                <Form.Check id={task.id} label={task.title} className="mb-0" />
                <Badge
                  bg={`${task.badgeVariant}-subtle`}
                  text={`${task.badgeVariant}-emphasis`}
                >
                  {task.priority}
                </Badge>
              </div>
              <ActionMenu
                toggleButton={<IconDotsVertical size={18} />}
                className="btn btn-ghost btn-icon rounded-circle"
                drop="start"
                align="start"
                size="sm"
              >
                <Dropdown.Item>Action</Dropdown.Item>
                <Dropdown.Item>Another action</Dropdown.Item>
                <Dropdown.Item>Something else here</Dropdown.Item>
              </ActionMenu>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
};

export default TaskList;

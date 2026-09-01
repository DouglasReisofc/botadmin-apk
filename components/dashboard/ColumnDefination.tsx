"use client";
//import node modules libraries
import { ColumnDef } from "@tanstack/react-table";
import { Badge, Dropdown } from "react-bootstrap";
import { IconDotsVertical } from "@tabler/icons-react";

//import custom typs
import { ProjectType } from "types/DashboardTypes";

//import custom components
import ActionMenu from "components/common/ActionMenu";
import { Avatar, AvatarGroup } from "components/common/Avatar";
import CustomProgressBar from "components/common/CustomProgressBar";

export const ActiveProjectColumns: ColumnDef<ProjectType>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const projectName = row.original.name;
      const deadline = row.original.deadline;

      return (
        <div>
          <div>{projectName}</div>
          <div className="small text-secondary">{deadline}</div>
        </div>
      );
    },
  },

  {
    accessorKey: "progress",
    header: "Progress",
    cell: ({ row }) => {
      const progress = row.original.progress;
      const barColor =
        progress < 30
          ? "danger"
          : progress < 50
          ? "warning"
          : progress > 50 && progress < 90
          ? "info"
          : "primary";
      return (
        <>
          <div className="me-3">{`${progress}%`}</div>
          <div className="w-50">
            <CustomProgressBar
              now={progress}
              variant={barColor}
              className="progress-sm"
              style={{ height: "5px" }}
            />
          </div>
        </>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const statusText = row.original.status;
      const colorCode =
        statusText === "On Track"
          ? "info"
          : statusText === "Delayed"
          ? "danger"
          : statusText === "At Risk"
          ? "warning"
          : "primary";
      return (
        <Badge bg={`${colorCode}-subtle`} text={`${colorCode}-emphasis`}>
          {row.original.status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "assignedAvatars",
    header: "Assigned",
    cell: ({ row }) => {
      const avatars = row.original.assignedAvatars;
      const maxAvatarsToShow = 3;
      const displayedAvatars = avatars.slice(0, maxAvatarsToShow);
      const remainingAvatars = avatars.length - displayedAvatars.length;
      const progress = row.original.progress;
      const bgColor =
        progress < 30
          ? "danger"
          : progress < 50
          ? "warning"
          : progress > 50 && progress < 90
          ? "info"
          : "primary";
      return (
        <AvatarGroup>
          {displayedAvatars.map((avatar, index) => (
            <Avatar
              key={index.toString()}
              type="image"
              src={avatar}
              size="sm"
              alt="User Avatar"
              className="rounded-circle"
            />
          ))}
          <span className={`avatar avatar-sm avatar-${bgColor}`}>
            <span className="avatar-initials rounded-circle">{`+${remainingAvatars}`}</span>
          </span>
        </AvatarGroup>
      );
    },
  },
  {
    header: "Actions",
    cell: () => {
      return (
        <ActionMenu
          toggleButton={<IconDotsVertical size={20} />}
          className="btn btn-ghost btn-icon btn-sm rounded-circle"
          drop="start"
          align="start"
        >
          <Dropdown.Item>Action</Dropdown.Item>
          <Dropdown.Item>Another action</Dropdown.Item>
          <Dropdown.Item>Something else here</Dropdown.Item>
        </ActionMenu>
      );
    },
  },
];

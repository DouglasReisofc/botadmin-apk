"use client";
//import node modules libraries
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { IconDotsVertical } from "@tabler/icons-react";
import { Image, Badge, Dropdown } from "react-bootstrap";

//import custom types
import { BlogPost } from "types/BlogType";

export const blogListColumns: ColumnDef<BlogPost>[] = [
  {
    accessorKey: "post_title",
    header: "Blog Title",
    cell: ({ row }) => {
      return (
        <div className="d-flex align-items-center gap-4">
          <div>
            <Link href="#!">
              <Image
                src={row.original.post_img}
                alt=""
                className="rounded-3"
                width="56"
                height="56"
              />
            </Link>
          </div>
          <div>
            <h5 className="mb-1 fs-6">
              <Link href="#!" className="text-inherit">
                {row.original.post_title}
              </Link>
            </h5>
            <div className="d-flex gap-3 text-secondary">
              <span>Feb 2, 2025</span>
              <span>John Doe</span>
            </div>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "post_views",
    header: "Post Views",
  },
  {
    accessorKey: "post_subscriber",
    header: "Subscriber",
  },
  {
    accessorKey: "post_likes",
    header: "Likes",
  },
  {
    accessorKey: "post_comments",
    header: "Comments",
  },
  {
    accessorKey: "post_status",
    header: "Status",
    cell: ({ row }) => {
      const statusText = row.original.post_status;
      const bgColor =
        statusText === "Published"
          ? "primary-subtle"
          : statusText === "Drafts"
          ? "warning-subtle"
          : "info-subtle";

      const textColor =
        statusText === "Published"
          ? "primary-emphasis"
          : statusText === "Drafts"
          ? "warning-emphasis"
          : "info-emphasis";

      return (
        <Badge bg={bgColor} text={textColor}>
          {row.original.post_status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "",
    header: "Action",
    cell: () => {
      return (
        <Dropdown drop="start">
          <Dropdown.Toggle variant="ghost" bsPrefix="rounded-circle btn-icon">
            <IconDotsVertical size={20} />
          </Dropdown.Toggle>
          <Dropdown.Menu align={"start"}>
            <Dropdown.Item className="d-flex align-items-center">
              Action
            </Dropdown.Item>
            <Dropdown.Item className="d-flex align-items-center">
              Another action
            </Dropdown.Item>
            <Dropdown.Item className="d-flex align-items-center">
              Something else here
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      );
    },
  },
];

//import node modules libraries
import {
  IconBriefcase,
  IconListCheck,
  IconSnowboarding,
  IconUsers,
} from "@tabler/icons-react";
import { v4 as uuid } from "uuid";

//import custom types
import {
  ActivityLogType,
  DashboardStatType,
  EventType,
  ProjectType,
  Task,
  TeamsProps,
} from "types/DashboardTypes";

export const DashboardStatsData: DashboardStatType[] = [
  {
    id: uuid(),
    title: "Total Projects",
    value: "6",
    icon: <IconBriefcase size={24} strokeWidth={1.5} />,
    bgColor: "bg-gradient-success",
    textColor: "text-success-emphasis",
    bottomValue: "2",
    description: "Completed",
  },
  {
    id: uuid(),
    title: "Task",
    value: "132",
    icon: <IconListCheck size={24} strokeWidth={1.5} />,
    bgColor: " bg-gradient-info",
    textColor: "text-info-emphasis",
    bottomValue: "28",
    description: "Completed",
  },
  {
    id: uuid(),
    title: "Members",
    value: "8",
    icon: <IconUsers size={24} strokeWidth={1.5} />,
    bgColor: "bg-gradient-success",
    textColor: "text-danger-emphasis",
    bottomValue: "2",
    description: "Completed",
  },
  {
    id: uuid(),
    title: "Productivity",
    value: "76%",
    icon: <IconSnowboarding size={24} strokeWidth={1.5} />,
    bgColor: "bg-gradient-warning",
    textColor: "text-warning-emphasis",
    bottomValue: "26%",
    description: "Increased",
  },
];

// Active projects data
export const activeProject: ProjectType[] = [
  {
    id: uuid(),
    name: "Website Redesign",
    deadline: "Jan 30, 2025",
    progress: 65,
    status: "On Track",
    assignedAvatars: [
      "/images/avatar/avatar-11.jpg",
      "/images/avatar/avatar-2.jpg",
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-3.jpg",
    ],
  },
  {
    id: uuid(),
    name: "Marketing Campaign",
    deadline: "Feb 10, 2025",
    progress: 20,
    status: "Delayed",
    assignedAvatars: [
      "/images/avatar/avatar-1.jpg",
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-4.jpg",
      "/images/avatar/avatar-4.jpg",
      "/images/avatar/avatar-4.jpg",
    ],
  },
  {
    id: uuid(),
    name: "Mobile App Development",
    deadline: "Mar 1, 2025",
    progress: 45,
    status: "At Risk",
    assignedAvatars: [
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-5.jpg",
      "/images/avatar/avatar-6.jpg",
      "/images/avatar/avatar-6.jpg",
    ],
  },
  {
    id: uuid(),
    name: "Customer Portal Upgrade",
    deadline: "Feb 15, 2025",
    progress: 89,
    status: "On Track",
    assignedAvatars: [
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-3.jpg",

      "/images/avatar/avatar-5.jpg",
      "/images/avatar/avatar-6.jpg",
    ],
  },
  {
    id: uuid(),
    name: "Product Launch",
    deadline: "Jan 25, 2025",
    progress: 100,
    status: "Completed",
    assignedAvatars: [
      "/images/avatar/avatar-3.jpg",
      "/images/avatar/avatar-8.jpg",
      "/images/avatar/avatar-9.jpg",
      "/images/avatar/avatar-9.jpg",
    ],
  },
];

export const teamMembers: TeamsProps[] = [
  {
    name: "John Doe",
    role: "Project Manager",
    avatar: "/images/avatar/avatar-1.jpg",
    tasksAssigned: 2,
  },
  {
    name: "Jane Smith",
    role: "Developer",
    avatar: "/images/avatar/avatar-14.jpg",
    tasksAssigned: 2,
  },
  {
    name: "Emily Johnson",
    role: "Designer",
    avatar: "/images/avatar/avatar-9.jpg",
    tasksAssigned: 3,
  },
  {
    name: "Jitu Chauhan",
    role: "Designer",
    avatar: "/images/avatar/avatar-6.jpg",
    tasksAssigned: 8,
  },
  {
    name: "Anita Parmar",
    role: "Front End Developer",
    avatar: "/images/avatar/avatar-5.jpg",
    tasksAssigned: 7,
  },
  {
    name: "Manasvi Suthar",
    role: "UI Developer",
    avatar: "/images/avatar/avatar-11.jpg",
    tasksAssigned: 3,
  },
];

export const activityLog: ActivityLogType[] = [
  {
    description: "Design phase completed by Alice.",
    timestamp: "Jan 20, 2025 10:30 AM",
    colorClass: "primary",
  },
  {
    description: "Initial client presentation delivered by Bob.",
    timestamp: "Jan 19, 2025: 3:45 PM",
    colorClass: "warning",
  },
  {
    description: "Resource allocation updated by Charlie.",
    timestamp: "Jan 18, 2025: 3:45 PM",
    colorClass: "primary",
  },
  {
    description: "Risk assessment review completed by Dana.",
    timestamp: "Jan 17, 2025: 3:45 PM",
    colorClass: "danger",
  },
  {
    description: "New milestone added by Eve.",
    timestamp: "Jan 16, 2025: 3:45 PM",
    colorClass: "primary",
  },
  {
    description: "New milestone added by Eve.",
    timestamp: "Jan 15, 2025: 3:45 PM",
    colorClass: "warning",
  },
];

export const tasks: Task[] = [
  {
    id: "taskCheck1",
    title: "Design project logo",
    priority: "High",
    badgeVariant: "info",
  },
  {
    id: "taskCheck2",
    title: "Create project plan",
    priority: "Medium",
    badgeVariant: "warning",
  },
  {
    id: "taskCheck3",
    title: "Update team assignments",
    priority: "Low",
    badgeVariant: "primary",
  },
  {
    id: "taskCheck4",
    title: "Prepare project budget",
    priority: "Critical",
    badgeVariant: "danger",
  },
  {
    id: "taskCheck5",
    title: "Dasher UI Figma Design",
    priority: "Low",
    badgeVariant: "primary",
  },
  {
    id: "taskCheck6",
    title: "Dasher UI Bootstrap Development",
    priority: "Low",
    badgeVariant: "primary",
  },
];

export const EventList: EventType[] = [
  {
    title: "Project Kickoff",
    date: "Jan 25, 2025",
    time: "10:00 AM",
    platform: "Zoom",
  },
  {
    title: "Project Kickoff",
    date: "Jan 25, 2025",
    time: "10:00 AM",
    platform: "Zoom",
  },
  {
    title: "Project Kickoff",
    date: "Jan 25, 2025",
    time: "10:00 AM",
    platform: "Zoom",
  },
];

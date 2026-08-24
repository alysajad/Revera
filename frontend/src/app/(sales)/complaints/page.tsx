import { ComplaintDesk } from "@/features/complaints/complaint-desk";

export const metadata = {
  title: "Complaints — River CRM",
  description: "Log and manage inbound customer complaint calls.",
};

export default function ComplaintsPage() {
  return <ComplaintDesk />;
}

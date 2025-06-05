import ProfilePage from "@/pages/profiles";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/profiles")({
  component: () => <ProfilePage />,
});

import ProxyPage from "@/pages/proxies";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <ProxyPage />,
});

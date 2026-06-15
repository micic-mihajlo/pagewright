import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/Editor";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Editor,
});

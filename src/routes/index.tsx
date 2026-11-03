import { createFileRoute } from "@tanstack/react-router";
import { Console } from "@/components/net/console";

export const Route = createFileRoute("/")({ component: Console });

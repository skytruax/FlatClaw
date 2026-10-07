import { redirect } from "next/navigation";

/** Sessions live in the chat sidebar; old links to this page land there. */
export default function SessionsPage() {
  redirect("/me/chat");
}

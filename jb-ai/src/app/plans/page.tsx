import { redirect } from "next/navigation";

// Packages page removed: the only upgrade path is the «اشترك الحين» Telegram card.
export default function PlansPage() {
  redirect("/");
}

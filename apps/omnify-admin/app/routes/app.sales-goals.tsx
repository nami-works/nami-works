import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/retail-goals${url.search}`);
};

export default function SalesGoalsRedirect() {
  return null;
}

import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { GoalsManagement } from "./components/GoalsManagement";
import { AverageTicket } from "./components/AverageTicket";
import { GoalsRanking } from "./components/GoalsRanking";
import { NotFound } from "./components/NotFound";
import { RedirectToHome } from "./components/RedirectToHome";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "goals", Component: GoalsManagement },
      { path: "average-ticket", Component: AverageTicket },
      { path: "ranking", Component: GoalsRanking },
      { path: "*", Component: NotFound },
    ],
  },
  // Redirects for old Portuguese routes
  { path: "/metas", Component: RedirectToHome },
  { path: "/ticket-medio", Component: RedirectToHome },
  { path: "/ranking-atingimento", Component: RedirectToHome },
  // Catch-all for any other unmatched routes
  { path: "*", Component: RedirectToHome },
]);
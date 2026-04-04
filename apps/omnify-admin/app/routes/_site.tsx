import { Outlet } from "react-router";

import { SiteNav, SiteFooter } from "../components/site-layout";

export default function SiteLayout() {
  return (
    <>
      <SiteNav />
      <main style={{ paddingTop: 60 }}>
        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}

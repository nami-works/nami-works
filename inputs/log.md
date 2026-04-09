[plugin:vite:import-analysis] Server-only module referenced by client

    '../services/merchandising/order-stats.server' imported by route 'app/routes/app.merchandising._index.tsx'

  React Router automatically removes server-code from these exports:
    `loader`, `action`, `middleware`, `headers`

  But other route exports in 'app/routes/app.merchandising._index.tsx' depend on '../services/merchandising/order-stats.server'.

  See https://reactrouter.com/explanation/code-splitting#removal-of-server-code
C:/Users/Lucas Guimarães/Desktop/cpg-labs/app/routes/app.merchandising._index.tsx:28:7
5  |  import { useLoaderData, useFetcher } from "react-router";
6  |  import { useTranslation } from "react-i18next";
7  |  import { computeStats } from "../services/merchandising/order-stats.server";
   |                                ^
8  |  import styles from "./app.merchandising/styles.module.css";
9  |  export default _c2 = _s(_UNSAFE_withComponentProps(_c = _s(function MerchandisingOverview() {
    at ResolveIdContext.resolveId (C:\Users\Lucas Guimarães\Desktop\cpg-labs\node_modules\@react-router\dev\dist\vite.js:4155:17)
    at processTicksAndRejections (node:internal/process/task_queues:103:5)
    at EnvironmentPluginContainer.resolveId (file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:42241:22)
    at TransformPluginContext.resolve (file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:42449:15)
    at normalizeUrl (file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:40492:26)
    at file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:40623:37
    at async Promise.all (index 7)
    at TransformPluginContext.transform (file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:40550:7)
    at EnvironmentPluginContainer.transform (file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:42323:18)
    at loadAndTransform (file:///C:/Users/Lucas%20Guimar%C3%A3es/Desktop/cpg-labs/node_modules/vite/dist/node/chunks/dep-D4NMHUTW.js:35739:27
Click outside, press Esc key, or fix the code to dismiss.
You can also disable this overlay by setting server.hmr.overlay to false in vite.config.ts.

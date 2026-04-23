// Root tools barrel. Importing this file registers every tool with the
// gateway registry, which is how createMcpServerForTenant knows what to
// serve. New tool verticals (e.g. Omie) add another side-effect import here.
import "./shopify/index.js";
import "./affiliates/index.js";

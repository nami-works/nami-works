// Root tools barrel. Importing this file registers every tool with the
// gateway registry, which is how createMcpServerForTenant knows what to
// serve. New tool verticals add another side-effect import here.
import "./shopify/index.js";
import "./omie/index.js";
import "./affiliates/index.js";
import "./instagram/index.js";
import "./brand/index.js";
import "./nami/index.js";

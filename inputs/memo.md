Memo to Claude

Here is what went wrong and how we fixed it.

What happened
- The Local Delivery loader ran a Shopify Admin API query that assumed a LocationConnection had a direct id field.
- The query asked for locationGroup.locations { id }, but locations is a connection and requires nodes or edges.
- This caused GraphQL to throw "Field 'id' doesn't exist on type 'LocationConnection'", which then crashed SSR and surfaced as "Unexpected Server Error".

Fix applied
- Updated the query to locationGroup.locations { nodes { id } }.
- Updated the response mapping to read locations.nodes and loop those ids.

How to prevent this next time
- Treat any Shopify GraphQL *Connection type as edges/nodes; never assume fields exist on the connection itself.
- When changing a query, update both the query and the TS response shape together.
- If you see a GraphqlQueryError, copy the exact schema type from the error into the query and refactor accordingly.
- Add a small helper type alias for the query response so TypeScript catches mismatches early.

If needed, I can add a small test or runtime guard to make this fail fast in a clearer way.

Additional issue found later
- The app crashed on SSR with "ReferenceError: React is not defined" because React was referenced (React.useRef / React.CSSProperties) without importing it.

Fix applied
- Switched to named React imports (useRef and CSSProperties) and removed React.* usage in that file.

How to prevent this next time
- Avoid using the React namespace unless you explicitly import React.
- Prefer named imports from react to keep SSR-safe and tree-shake friendly.
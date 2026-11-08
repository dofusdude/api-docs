import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spec = YAML.parse(fs.readFileSync(path.join(root, "openapi-3.0.yaml"), "utf8"));

// Keep the 3.0 document available for existing SDK generators. This derived
// document uses 3.2's native QUERY operation and JSON Schema nullability.
function migrate(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(migrate);
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, migrate(child)]));
  if ("nullable" in result) {
    const nullable = result.nullable;
    delete result.nullable;
    if (nullable) {
      if (result.type) result.type = [...new Set([...[result.type].flat(), "null"])];
      else return { anyOf: [result, { type: "null" }] };
      if (result.enum && !result.enum.includes(null)) result.enum.push(null);
    }
  }
  for (const [exclusive, inclusive] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]]) {
    if (typeof result[exclusive] === "boolean") {
      if (result[exclusive]) { result[exclusive] = result[inclusive]; delete result[inclusive]; }
      else delete result[exclusive];
    }
  }
  return result;
}
const output = migrate(spec);
output.openapi = "3.2.0";
output.servers.push({ url: "http://localhost:3000", description: "Local development" });
const schemas = output.components.schemas;
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const ids = { type: "array", minItems: 1, maxItems: 100, items: { type: "integer", minimum: 0 }, description: "Match any of these Ankama IDs." };
schemas.EntityQueryRange = {
  type: "object", additionalProperties: false, minProperties: 1,
  description: "Inclusive bounds; min must not exceed max.",
  properties: { min: { type: "integer", minimum: 0 }, max: { type: "integer", minimum: 0 } }
};
schemas.EntityQueryPage = {
  type: "object", additionalProperties: false,
  properties: {
    number: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
    size: { type: "integer", minimum: 1, maximum: 100, default: 16 }
  }
};
for (const [resource, title] of [["monsters", "Monster"], ["spells", "Spell"], ["classes", "Class"], ["super-areas", "SuperArea"], ["areas", "Area"], ["subareas", "Subarea"]]) {
  const filterName = `${title}QueryFilter`;
  const properties = {
    and: { type: "array", minItems: 1, maxItems: 63, items: ref(filterName) },
    or: { type: "array", minItems: 1, maxItems: 63, items: ref(filterName) },
    ids,
    name: { type: "string", minLength: 1, maxLength: 200, description: "Case-insensitive substring of the localized name (English fallback). Must not be whitespace-only; at most 200 UTF-8 bytes. Not a full-text query." }
  };
  if (resource === "monsters") Object.assign(properties, {
    level: { ...ref("EntityQueryRange"), description: "At least one monster grade must have a level in this range." },
    subarea_ids: { ...ids, description: "Match a mapped spawn subarea." },
    spell_ids: { ...ids, description: "Match a spell assigned to any monster grade, including starting spells." }
  });
  else if (resource === "spells") Object.assign(properties, {
    ap_cost: ref("EntityQueryRange"),
    min_player_level: ref("EntityQueryRange")
  });
  schemas[filterName] = {
    type: "object", additionalProperties: false,
    description: "All fields in a node are ANDed; ID values within a list are ORed. 'and' requires every child, 'or' at least one. Maximum depth 8 and 64 total nodes. An empty object matches all entities. Spell AP cost and minimum player level in the same node must match the same spell level. Matching selects whole entities; it does not trim their grades/levels.",
    properties
  };
  const requestName = `${title}Query`;
  schemas[requestName] = {
    type: "object", additionalProperties: false,
    properties: {
      filter: ref(filterName),
      sort: { type: "array", maxItems: 2, items: { type: "string", enum: ["ankama_id", "-ankama_id", "name", "-name"] }, description: "Unique fields. Case-insensitive localized name sorting; Ankama ID is the final tie-breaker. Defaults to ascending Ankama ID." },
      page: ref("EntityQueryPage"),
      fields: { type: "object", additionalProperties: false, properties: { [resource.replaceAll("-", "_")]: { type: "array", minItems: 1, maxItems: 1, items: { type: "string", enum: ["all"] } } }, description: "Select this collection's complete localized documents instead of summaries." },
      include: resource === "monsters"
        ? { type: "array", maxItems: 1, items: { type: "string", enum: ["spells", "spells.grade"] }, description: "Use existing v1 monster spell includes. Automatically enables full documents." }
        : { type: "array", maxItems: 0, items: { type: "string" }, description: "No includes are currently supported for this collection." }
    }
  };
  const item = output.paths[`/{game}/v1/{language}/${resource}`];
  item.get.parameters.push(
    { name: "filter", in: "query", description: "JSON-encoded filter, evaluated identically to QUERY. Prefer QUERY for complex filters. Advanced filters/sorting limit page size to 100.", content: { "application/json": { schema: ref(filterName) } } },
    { name: "sort", in: "query", description: "Comma-separated sort fields; identical to QUERY sorting.", schema: { type: "string", example: "name,-ankama_id" } }
  );
  item.query = {
    operationId: `query-${resource}`, summary: `Query ${resource}`, tags: ["game data"],
    description: "Read-only structured query (RFC 10008). Maximum JSON body size 64 KiB. Existing v1 collection and entity schemas are unchanged. Empty results return 200 with an empty collection. Pagination links must be followed with QUERY and the SAME JSON body: URL page[number]/page[size] override body pagination. These are not GET links. Other URL parameters are rejected. Cache-Control: no-store prevents unsafe URL-only caching until body-aware caching is deployed.",
    parameters: [
      { name: "page[number]", in: "query", description: "Override body page.number when following pagination links.", schema: { type: "integer", minimum: 1, maximum: 1000000 } },
      { name: "page[size]", in: "query", description: "Override body page.size.", schema: { type: "integer", minimum: 1, maximum: 100 } }
    ],
    requestBody: { required: true, content: { "application/json": {
      schema: ref(requestName),
      example: resource === "monsters"
        ? { filter: { and: [{ level: { min: 100, max: 200 } }, { or: [{ subarea_ids: [123, 456] }, { spell_ids: [10] }] }] }, include: ["spells.grade"], sort: ["name"], page: { number: 1, size: 20 } }
        : resource === "spells" ? { filter: { ap_cost: { max: 3 }, min_player_level: { max: 100 } }, sort: ["name"], page: { number: 1, size: 20 } } : { filter: { name: "a" }, sort: ["name"], page: { number: 1, size: 20 } }
    } } },
    responses: Object.fromEntries([
      ["200", { description: "Paginated matching entities, using existing v1 response schemas.", headers: { "Accept-Query": { schema: { type: "string", const: "application/json" } }, "Cache-Control": { schema: { type: "string", const: "no-store" } } }, content: { "application/json": { schema: ref("MappedEntityCollection") } } }],
      ...[["400", "Invalid JSON, unsupported fields, invalid filters, pagination or complexity limit."], ["413", "Query exceeds 64 KiB."], ["415", "Content-Type must be application/json."]].map(([code, description]) => [code, { description, content: { "application/json": { schema: ref("Error") } } }])
    ])
  };
  item.options = {
    operationId: `options-${resource}`, summary: `Discover ${resource} query support`, tags: ["game data"],
    responses: { "204": { description: "Supported methods and query media type.", headers: { Allow: { schema: { type: "string", const: "GET, QUERY, OPTIONS" } }, "Accept-Query": { schema: { type: "string", const: "application/json" } } } } }
  };
}
// The same Go registry controls runtime routing, typed request decoding, CORS
// discovery and these schemas. Regenerate query-contract.json from doduapi.
const endpoints = JSON.parse(fs.readFileSync(path.join(root, "query-contract.json"), "utf8"));
for (const endpoint of endpoints.filter(entry => !entry.mapped)) {
  const pathKey = output.paths[endpoint.path] ? endpoint.path : endpoint.path.replace("{game}", "dofus3");
  const item = output.paths[pathKey];
  if (!item?.get) throw new Error(`QUERY contract has no GET schema: ${endpoint.path}`);
  const properties = {};
  const existingParameters = [...(item.parameters ?? []), ...(item.get.parameters ?? [])].map(parameter => {
    if (parameter.$ref) return output.components.parameters[parameter.$ref.split("/").at(-1)];
    return parameter;
  });
  for (const parameter of endpoint.parameters ?? []) {
    let schema = { type: parameter.type === "strings" ? "array" : parameter.type };
    if (parameter.type === "strings") schema = { type: "array", minItems: 1, maxItems: 100, items: { type: "string", minLength: 1, pattern: "^[^,]+$" } };
    const existing = existingParameters.find(candidate => candidate.name === parameter.name);
    if (existing?.description) schema.description = existing.description;
    if (parameter.group === "page") {
      schema.minimum = 1; schema.maximum = parameter.key === "size" ? 100 : 1000000;
      schema.description = parameter.key === "size" ? "QUERY page size (1–100). The legacy GET unlimited sentinel is not accepted in QUERY; use /all where offered." : "One-based page number; defaults to 1.";
    }
    if (parameter.group) {
      properties[parameter.group] ??= { type: "object", additionalProperties: false, properties: {} };
      const keys = parameter.key.split(".");
      let parent = properties[parameter.group];
      for (const key of keys.slice(0, -1)) {
        parent.properties[key] ??= { type: "object", additionalProperties: false, properties: {} };
        parent = parent.properties[key];
      }
      parent.properties[keys.at(-1)] = schema;
    } else properties[parameter.key] = schema;
  }
  if (endpoint.sort?.length) properties.sort = { type: "array", maxItems: endpoint.sort.length, items: { type: "string", enum: endpoint.sort.flatMap(field => [field, `-${field}`]) }, description: "Ascending fields, or prefix '-' for descending. No duplicate fields." };
  if (endpoint.fields) {
    const existing = existingParameters.find(candidate => candidate.name === `fields[${endpoint.fields}]`);
    if (existing?.schema?.items) existing.schema.items.enum = endpoint.field_values;
    properties.fields = { type: "object", additionalProperties: false, properties: { [endpoint.fields]: { type: "array", maxItems: 100, items: { type: "string", enum: endpoint.field_values }, description: existing?.description ?? "Existing v1 expansion field names." } } };
  }
  const schemaName = "Query" + endpoint.path.replaceAll(/\{[^}]+\}/g, "").split("/").filter(Boolean).map(value => value.split("-").map(word => word[0].toUpperCase()+word.slice(1)).join("")).join("");
  schemas[schemaName] = { type: "object", additionalProperties: false, properties, ...(properties.query ? { required: ["query"] } : {}), description: "Structured JSON query. Related filter properties are nested objects: filter.type.name_id and filter.family.id/name. Literal dotted keys are rejected. GET parameter names remain unchanged. Both transports use shared typed validation and execution. No additional nested AND/OR syntax is implied for legacy filters." };
  const responses = structuredClone(item.get.responses);
  for (const [code, description] of [["400", "Invalid parameters or JSON."], ["413", "Query body exceeds 64 KiB."], ["415", "Content-Type must be application/json."]]) responses[code] = { description, content: { "application/json": { schema: ref("Error") } } };
  item.query = {
    operationId: `query-${item.get.operationId}`, summary: item.get.summary.replace(/^(List|Get|Search)/, "Query"), tags: item.get.tags,
    description: "Read-only JSON alternative to this GET operation. Maximum 64 KiB; unknown keys and nulls are rejected. Existing v1 response and error schemas are retained, including existing empty-result behavior. Follow pagination links using QUERY and the SAME JSON body; URL page[number]/page[size] override body pagination. No other URL parameters are allowed. Responses use Cache-Control: no-store until body-aware caching is deployed.",
    requestBody: { required: true, content: { "application/json": { schema: ref(schemaName) } } },
    ...(properties.page ? { parameters: [
      { name: "page[number]", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000000 } },
      { name: "page[size]", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }
    ] } : {}),
    responses
  };
  item.options = { operationId: `options-${item.get.operationId}`, summary: "Discover supported query methods", tags: item.get.tags, responses: { "204": { description: "Supported methods and query media type.", headers: { Allow: { schema: { type: "string", const: "GET, QUERY, OPTIONS" } }, "Accept-Query": { schema: { type: "string", const: "application/json" } } } } } };
}
const generated = "# Generated by npm run build; edit openapi-3.0.yaml or scripts/build-openapi.mjs.\n" + YAML.stringify(output, { lineWidth: 0 });
const destination = path.join(root, "openapi-3.2.yaml");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== generated) {
    console.error("openapi-3.2.yaml is out of date; run npm run build"); process.exit(1);
  }
} else fs.writeFileSync(destination, generated);

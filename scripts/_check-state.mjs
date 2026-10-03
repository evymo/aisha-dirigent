const d = require("./aisha/db/migration-registry.json");
const fs = require("fs");
const files = fs.readdirSync("./aisha/db/migrations").filter((f) => f.endsWith(".sql"));
const registered = new Set(d.migrations.map((m) => m.filename || m.name || m));
console.log("Registry entries:", d.migrations.length);
console.log("Migration files on disk:", files.length);
const unregistered = files.filter((f) => !registered.has(f));
if (unregistered.length) {
  console.log("UNREGISTERED MIGRATIONS:", unregistered.join(", "));
} else {
  console.log("✓ All migrations registered");
}

// Also dump the registry structure
console.log("\nRegistry sample:", JSON.stringify(d.migrations.slice(0, 2), null, 2));

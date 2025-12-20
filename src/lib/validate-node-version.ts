import { createRequire } from "node:module";
import semver from "semver";
import type { PackageJson } from "../index.js";

const require = createRequire(import.meta.url);
const pkg: PackageJson = require("../../package.json");

export const validateNodeVersion = () =>
	semver.satisfies(process.versions.node, pkg.engines.node);

// bun 1.4.x resolves the bare "solid-js" specifier to the SSR build
// (dist/server.js) because its default "node" export condition wins even when
// --conditions=browser is passed. OpenTUI's universal Solid renderer requires
// the client build (dist/solid.js): the SSR build executes effects eagerly and
// non-reactively, which makes every element's children spread immediately at
// creation, inserting empty text nodes into <box> elements and tripping
// OpenTUI's strict orphan-text check ("Orphan text error: "" must have a
// <text> as a parent"). This alias makes the resolution explicit and
// deterministic for both `bun test` and `bun run`.
import { plugin } from "bun";

const SOLID_JS_ROOT = `${import.meta.dir}/../node_modules/solid-js`;

plugin({
	name: "solid-js-client-alias",
	setup(build) {
		build.onResolve({ filter: /^solid-js$/ }, () => ({
			path: `${SOLID_JS_ROOT}/dist/solid.js`,
		}));
		build.onResolve({ filter: /^solid-js\/store$/ }, () => ({
			path: `${SOLID_JS_ROOT}/store/dist/store.js`,
		}));
		build.onResolve({ filter: /^solid-js\/web$/ }, () => ({
			path: `${SOLID_JS_ROOT}/web/dist/web.js`,
		}));
	},
});
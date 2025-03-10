import { Server } from 'SERVER';
import { manifest, prerendered, base_path } from 'MANIFEST';

const server = new Server(manifest);

const app_path = `/${manifest.appPath}`;

const immutable = `${app_path}/immutable/`;
const version_file = `${app_path}/version.json`;

export default {
	/**
	 * @param {Request} req
	 * @param {any} env
	 * @param {any} context
	 */
	async fetch(req, env, context) {
		await server.init({ env });

		const url = new URL(req.url);

		// static assets
		if (url.pathname.startsWith(app_path)) {
			/** @type {Response} */
			const res = await env.ASSETS.fetch(req);
			if (is_error(res.status)) return res;

			const cache_control = url.pathname.startsWith(immutable)
				? 'public, immutable, max-age=31536000'
				: 'no-cache';

			return new Response(res.body, {
				headers: {
					// include original headers, minus cache-control which
					// is overridden, and etag which is no longer useful
					'cache-control': cache_control,
					'content-type': res.headers.get('content-type'),
					'x-robots-tag': 'noindex'
				}
			});
		}

		let { pathname, search } = url;
		try {
			pathname = decodeURIComponent(pathname);
		} catch {
			// ignore invalid URI
		}

		const stripped_pathname = pathname.replace(/\/$/, '');

		// prerendered pages and /static files
		let is_static_asset = false;
		const filename = stripped_pathname.slice(base_path.length + 1);
		if (filename) {
			is_static_asset =
				manifest.assets.has(filename) ||
				manifest.assets.has(filename + '/index.html') ||
				filename in manifest._.server_assets ||
				filename + '/index.html' in manifest._.server_assets;
		}

		let location = pathname.at(-1) === '/' ? stripped_pathname : pathname + '/';

		if (prerendered.has(pathname)) {
			url.pathname = '/' + prerendered.get(pathname).file;
			return env.ASSETS.fetch(new Request(url.toString(), req));
		} else if (is_static_asset || pathname === version_file || pathname.startsWith(immutable)) {
			return env.ASSETS.fetch(req);
		} else if (location && prerendered.has(location)) {
			if (search) location += search;
			return new Response('', {
				status: 308,
				headers: {
					location
				}
			});
		}

		// dynamically-generated pages
		return await server.respond(req, {
			platform: {
				env,
				context,
				// @ts-expect-error lib.dom is interfering with workers-types
				caches,
				// @ts-expect-error req is actually a Cloudflare request not a standard request
				cf: req.cf
			},
			getClientAddress() {
				return req.headers.get('cf-connecting-ip');
			}
		});
	}
};

/**
 * @param {number} status
 * @returns {boolean}
 */
function is_error(status) {
	return status > 399;
}

# CXone page-content encoding

CXone's page-content endpoint expects `Content-Type: text/plain; charset=utf-8` for UTF-8 HTML. SDK 1.7.0 sends `text/plain` without a charset. Non-ASCII characters can consequently become question marks when edits are saved.

The root postinstall script applies a narrow compatibility patch to the page writer in both SDK entry points. The dependency is pinned to 1.7.0; the patch stops installation on an unexpected version or method layout, so an SDK upgrade requires explicit compatibility review. The Docker build copies the patch before dependency installation. Installations that intentionally disable lifecycle scripts must run `node tools/patch-cxone-utf8.mjs` before running Remedy.

The regression test captures real HTTP requests from both the ESM and CommonJS SDK entry points, asserting the content type and UTF-8 scientific text. Authentication, sandbox guards, snapshots, revision metadata and the HTML payload remain unchanged. Existing damaged text still needs content review; changing the request header cannot recover previously lost characters.

Reference: https://expert-help.nice.com/Integrations_and_Extending_Content/API/Core_Resources/Page

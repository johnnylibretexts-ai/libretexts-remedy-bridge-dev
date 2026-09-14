# Dependency security validation

The September 2026 dependency refresh addresses all 33 reported Dependabot alerts (3 critical, 11 high, 17 moderate, 2 low). No alert was dismissed or accepted as an exception.

| Package | Resolved version | Affected surface |
| --- | --- | --- |
| vitest, @vitest/mocker | 4.1.11 | Test runner and development tooling |
| shell-quote | 1.9.0 | Development process launcher |
| axios | 1.18.0 | CXone HTTP client; runtime exposure |
| form-data | 4.0.6 | HTTP multipart dependency; runtime exposure |
| vite | 6.4.3 | Panel build/development server |
| postcss | 8.5.28 | CSS build tooling |
| nanoid | 3.3.19 | Transitive tooling |
| browserslist | 4.28.9 | Browser target tooling |
| baseline-browser-mapping | 2.11.23 | Browser target data |
| esbuild | 0.28.2 / 0.25.12 | Build tooling |
| @babel/core | 7.29.7 | JavaScript build tooling |

The lockfile resolves patched releases throughout the workspace. Vitest required a major-version upgrade; the core test suite passes on Vitest 4. The other updates remain within existing package constraints.

Validation: full `npm audit --json` reports zero vulnerabilities in all severity categories, including development dependencies. `npm run build` builds all three workspaces. The Linux container uses `npm ci` from the same lockfile and passes the core tests. This verifies the reported dependency set; continue automated dependency monitoring as new advisories are published.

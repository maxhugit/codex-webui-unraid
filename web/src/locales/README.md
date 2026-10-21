# Translation catalogs

The application uses one directory per locale and i18next namespaces.

- `en` is the source and fallback locale.
- `fr` contains the French translations.
- `legacy` temporarily contains the existing English natural-language keys.

The legacy namespace preserves the current interface while features are moved
incrementally to semantic keys. Authentication is the first migrated domain and
uses the matching `en/authentication.json` and `fr/authentication.json`
catalogs. New domains follow the same structure and register their namespace in
`index.ts`.

Every locale must expose the same keys and interpolation variables. The catalog
tests and `pnpm check:i18n` enforce this requirement before another language is
enabled. The CI also rejects missing or additional namespaces, missing or
additional keys relative to the English source, incompatible interpolation
variables, and non-semantic keys in migrated namespaces.

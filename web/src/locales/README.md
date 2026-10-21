# Translation catalogs

The application uses one directory per locale and i18next namespaces.

- `en` is the source and fallback locale.
- `fr` contains the French translations.
- `legacy` temporarily contains the existing English natural-language keys.

The legacy namespace preserves the current interface while features are moved
incrementally to semantic keys. A migrated feature should use its own matching
catalog in every locale, for example `en/authentication.json` and
`fr/authentication.json`, and register that namespace in `index.ts`.

Every locale must expose the same keys and interpolation variables. The catalog
tests enforce this requirement before another language is enabled.

# Translation catalogs

The application uses one directory per locale and i18next namespaces. Locale
metadata lives in `manifest.json`; the account language selector is generated
from this manifest rather than hard-coded in a component.

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

## Add a language

From `web/`, run:

```sh
pnpm i18n:add-locale -- es "Español"
```

The command creates every namespace from the English source and registers the
language in the manifest. Translate the copied values without changing their
keys or `{{variables}}`, then run `pnpm check:i18n` and the unit tests. The new
language automatically appears in **My account** after the application is
rebuilt; no React component or server allow-list needs to be changed.

Catalogs are loaded through dynamic imports. The initial bundle downloads only
the detected language and its fallback when needed, so adding languages does
not add every translation to every user's startup download.

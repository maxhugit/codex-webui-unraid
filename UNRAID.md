# Codex WebUI image for Unraid

This repository is a private deployment fork of
[LimLLL/codex-webui](https://github.com/LimLLL/codex-webui). The upstream
project remains licensed under the GNU AGPL v3 or later; its original license
is preserved in `LICENSE`.

## Published image

Every push to `main` builds the Unraid-specific image and publishes it to:

```text
ghcr.io/maxhugit/codex-webui-unraid:latest
```

The workflow also publishes an immutable `sha-<commit>` tag. The image is
built for `linux/amd64`, matching the current Unraid server.

## Persistent data

Runtime data is deliberately excluded from this repository and image. Keep
the following outside Git and mount them when deploying:

- the Codex home directory and OAuth credentials;
- the WebUI SQLite database;
- workspaces and logs;
- SSH private keys;
- backend tokens and other Docker secrets.

The active Unraid deployment stores these under
`/mnt/pool/appdata/codex-webui-limlll/state`.

## Simple Chat through the OpenAI API

The **Simple Chat** entry is separate from Codex work sessions. It calls the
OpenAI Responses API without SSH, MCP, or filesystem access and uses a small
default model. Web search is the only tool available to this chat.

The API key must never be committed to this repository or passed to the web
browser. The Unraid deployment mounts it as a read-only secret file and uses:

```text
OPENAI_API_KEY_FILE=/run/secrets/openai_api_key
OPENAI_CHAT_MODEL=gpt-5-mini
```

The application does not impose a fixed output-token limit. The selected
model, its context window, and the OpenAI API limits still apply.

The host-side secret is stored at
`/mnt/pool/appdata/codex-webui-limlll/state/openai-api-key.txt`, owned by root
and readable only by the container's restricted group. Starting a new chat
clears the browser-side conversation identifier. OpenAI API usage is billed
separately from the ChatGPT/Codex subscription.

The application can also replace the key from **Settings → Chat simple**. A
key entered there is written atomically with mode `0600` below the persistent
Codex home and takes precedence over the read-only bootstrap secret. The key
value is never returned by the API. Chat history, selected models, token usage,
and source links are stored in the existing WebUI SQLite database.

## Updating Codex CLI

Change `CODEX_CLI_VERSION` in
`.github/workflows/docker-publish.yml`, commit the change, and let GitHub
Actions publish a new immutable image. Test the `sha-<commit>` tag on Unraid
before promoting or relying on `latest`.

## Updating from the original project

`Check for upstream updates` runs every Monday and can also be started
manually from GitHub Actions. It fetches `LimLLL/codex-webui` and opens a pull
request when upstream changed.

Upstream changes are never deployed automatically. Review and merge the pull
request first. Merging into `main` then triggers the image workflow, which
publishes a new `sha-<commit>` image and refreshes `latest`.

If upstream changed a file that this deployment also customizes, the sync job
stops on a merge conflict instead of overwriting the local security changes.

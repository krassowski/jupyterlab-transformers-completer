# jupyterlab-transformers-completer

[![Extension status](https://img.shields.io/badge/status-experimental-red 'not ready to be used')](https://jupyterlab-contrib.github.io/)
[![Build](https://github.com/krassowski/jupyterlab-transformers-completer/actions/workflows/build.yml/badge.svg)](https://github.com/krassowski/jupyterlab-transformers-completer/actions/workflows/build.yml)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/krassowski/jupyterlab-transformers-completer/main?urlpath=lab)

Inline completion provider using `transformers.js` for JupyterLab

This extension is aimed for developers of JupyterLab extensions (and advanced JupyterLab users) to explore the integration of the inline completions API added in JupyterLab 4.1.

All models linked from this demonstration run exclusively **in your browser**, and are:

- order of magnitudes smaller than the state-of-the-art models,
- producing correspondingly lower accuracy of suggestions/answers.

These models are not vetted for accuracy nor propriety and should not be deployed without further validation.

![demo-transformers](https://github.com/krassowski/jupyterlab-transformers-completer/assets/5832902/c81ca9c1-925d-498d-8650-520f8a570f99)

### Usage

1. Go to Settings → Inline Completer → choose the models for code (in code cells and scripts) and text (in markdown cells and plain files) generation.
2. The models will be downloaded, compiled, and cached in your browser as indicated by pop-up notifications in bottom right corner.
3. Start typing a few words in the code cell or Markdown cell and observe the suggestions; hover over to see shortcuts.
4. Adjust model configuration in settings as needed; in particular increasing the repetition penalty, adjusting temperature and top _k_ is recommended.

### Known issues

- Sometimes it is required to go to settings after installation and modify settings to trigger model download and compilation
- Sometimes the browser will cache a faulty (e.g not fully downloaded) file resulting in Syntax Error when parsing; you can try in an incognito/private mode to confirm that this is transient and clear browser cache to remove such file.

## Requirements

- JupyterLab >= 4.1.0 or Jupyter Notebook >= 7.1.0
- A browser supporting:
  - [`SharedArrayBuffer`](https://caniuse.com/sharedarraybuffer)
  - [Web Workers](https://caniuse.com/webworkers)
  - Dynamic import for workers (behind `dom.workers.modules.enabled` in Firefox)
  - (optional, for faster inference) [WebGPU](https://caniuse.com/webgpu) (behind `dom.webgpu.enabled` in Firefox)
- `jupyter-server` to enable additional headers (`jupyverse` and `jupyterlite` not tested yet)

When this extension is enabled, the server will return additional headers,
which will prevent fetching external resources, for example the extension logos
from GitHub will no longer load in the extension panel.

The additional headers are used to enable synchronous communication with WebWorker via `SharedArrayBuffer`:

```http
Cross-Origin-Opener-Policy: same-origin,
Cross-Origin-Embedder-Policy: require-corp
```

## Install

To install the extension, execute:

```bash
pip install -U 'jupyterlab>=4.1.0' jupyterlab-transformers-completer
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab-transformers-completer
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab-transformers-completer directory
# Install package in development mode
pip install -e "."
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Development uninstall

```bash
pip uninstall jupyterlab-transformers-completer
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `@jupyterlab/transformers-completer` within that folder.

### Packaging the extension

See [RELEASE](RELEASE.md)

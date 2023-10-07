try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'jupyterlab-transformers-completer' outside a proper installation.")
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "@jupyterlab/transformers-completer"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_transformers_completer"
    }]


def _load_jupyter_server_extension(server_app):
    """
    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    if "headers" not in server_app.web_app.settings:
      server_app.web_app.settings["headers"] = {}
    server_app.web_app.settings["headers"].update({
      # Allow access to `SharedArrayBuffer`.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    })
    name = "@jupyterlab/transformers-completer"
    server_app.log.info(f"Registered {name} server extension")


# For backward compatibility with notebook server - useful for Binder/JupyterHub
load_jupyter_server_extension = _load_jupyter_server_extension

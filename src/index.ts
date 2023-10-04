import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  ICompletionProviderManager,
  IInlineCompletionProvider,
  IInlineCompletionContext,
  CompletionHandler,
  IInlineCompletionList,
  IInlineCompletionItem
} from '@jupyterlab/completer';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Notification } from '@jupyterlab/apputils';
import { JSONValue, PromiseDelegate } from '@lumino/coreutils';
import { Debouncer } from '@lumino/polling';
import type { ClientMessage } from './types';
import { formatFileSize } from './utils';

interface ISettings {
  temperature: number;
  codeModel: string;
  textModel: string;
  maxNewTokens: number;
  topK: number;
  doSample: boolean;
  generateN: number;
  debounceMilliseconds: number;
  maxContextWindow: number;
}

const DEFAULT_SETTINGS: ISettings = {
  codeModel: 'Xenova/tiny_starcoder_py',
  textModel: 'Xenova/gpt2',
  temperature: 0.5,
  doSample: false,
  topK: 5,
  maxNewTokens: 50,
  generateN: 2,
  debounceMilliseconds: 0,
  maxContextWindow: 512
};

interface IOptions {
  worker: Worker;
}

interface IStream {
  done: boolean;
  response: IInlineCompletionItem;
}

class TransformersInlineProvider implements IInlineCompletionProvider {
  constructor(protected options: IOptions) {
    const buffer = new SharedArrayBuffer(1024);
    this._sharedArray = new Int32Array(buffer);
    options.worker.addEventListener(
      'message',
      this.onMessageReceived.bind(this)
    );
    this._postMessage({
      action: 'initializeBuffer',
      buffer: buffer
    });
  }

  readonly identifier = '@krassowski/inline-completer';
  readonly name = 'Transformers powered completions';

  get schema(): ISettingRegistry.IProperty {
    // full list of models: https://huggingface.co/models?pipeline_tag=text-generation&library=transformers.js
    const codeModels = [
      'none',
      'Xenova/tiny_starcoder_py',
      'Xenova/codegen-350M-mono',
      'Xenova/codegen-350M-multi',
      'Xenova/starcoderbase-1b-sft',
      'Xenova/WizardCoder-1B-V1.0'
    ];
    const textModels = [
      'none',
      'Xenova/gpt2',
      'Xenova/TinyLLama-v0',
      'Xenova/LaMini-GPT-124M',
      'Xenova/LaMini-Cerebras-111M',
      'Xenova/opt-125m',
      'Xenova/pythia-70m-deduped',
      'Xenova/distilgpt2',
      'Xenova/llama-160m'
    ];
    return {
      properties: {
        codeModel: {
          title: 'Code model',
          description: 'Model used in code cells and code files.',
          enum: codeModels,
          type: 'string'
        },
        textModel: {
          title: 'Text model',
          description:
            'Model used in Markdown (cells and files) and plain text files.',
          enum: textModels,
          type: 'string'
        },
        // TODO temperature and friends should be per-model
        temperature: {
          minimum: 0,
          maximum: 1,
          type: 'number',
          title: 'Temperature',
          description: 'The value used to module the next token probabilities.'
        },
        doSample: {
          type: 'boolean',
          description: 'Whether to use sampling; use greedy decoding otherwise.'
        },
        topK: {
          minimum: 0,
          maximum: 50,
          type: 'number',
          title: 'Top k',
          description:
            'The number of highest probability vocabulary tokens to keep for top-k-filtering.'
        },
        maxNewTokens: {
          minimum: 1,
          maximum: 512,
          type: 'number',
          title: 'Maximum number of new tokens.'
        },
        generateN: {
          minimum: 1,
          maximum: 10,
          type: 'number'
        },
        debounceMilliseconds: {
          title: 'Debouncer delay',
          minimum: 0,
          type: 'number',
          description:
            'Time since the last key press to start generation (debouncer) in milliseconds.'
        },
        // TODO: characters are a poor proxy for number of tokens when whitespace are many (though a strictly conservative one).
        // Words could be better but can be over-optimistic - one word canb e several tokens).
        maxContextWindow: {
          title: 'Maximum context window',
          minimum: 1,
          type: 'number',
          description:
            'At most how many characters should be provided to the model. Smaller context results in faster generation at a cost of less accurate suggestions.'
        }
      },
      default: DEFAULT_SETTINGS as any
    };
  }

  configure(settings: { [property: string]: JSONValue }): void {
    this._settings = settings as any as ISettings;
    this._debouncer = new Debouncer(
      this._fetch.bind(this),
      this._settings.debounceMilliseconds ??
        DEFAULT_SETTINGS.debounceMilliseconds
    );

    this._switchModel(this._settings.codeModel, 'code');
    this._switchModel(this._settings.textModel, 'text');
  }

  private _switchModel(newModel: string, type: 'code' | 'text') {
    const oldModel = this._currentModels[type];
    if (oldModel === newModel) {
      return;
    }
    if (oldModel) {
      this._postMessage({
        action: 'disposeModel',
        model: oldModel
      });
    }
    if (newModel !== 'none') {
      this._postMessage({
        action: 'initializeModel',
        model: newModel
      });
    }
    this._currentModels[type] = newModel;
  }

  // TODO types
  onMessageReceived(e: any) {
    const data = e.data;
    // TODO: maybe only tick on update?
    this._tickWorker();
    switch (e.data.status) {
      case 'initiate': {
        this._ready = new PromiseDelegate();
        const message = `Loading ${data.model}: ${data.file}`;
        if (this._loadingNotifications[data.model]) {
          Notification.update({
            id: this._loadingNotifications[data.model],
            message,
            autoClose: false
          });
        } else {
          this._loadingNotifications[data.model] = Notification.emit(
            message,
            'in-progress',
            { autoClose: false }
          );
        }
        break;
      }
      case 'progress':
        Notification.update({
          id: this._loadingNotifications[data.model],
          message: `Loading ${data.model}: ${data.file} ${Math.round(
            data.progress
          )}% (${formatFileSize(data.loaded, 1)}/${formatFileSize(
            data.total
          )})`,
          type: 'in-progress',
          autoClose: false,
          progress: data.progress / 100
        });
        break;

      case 'done':
        Notification.update({
          id: this._loadingNotifications[data.model],
          message: `Loaded ${data.file} for ${data.model}`,
          type: 'success',
          autoClose: false
        });
        break;

      case 'ready':
        Notification.dismiss(this._loadingNotifications[data.model]);
        this._ready.resolve(void 0);
        break;

      case 'update': {
        const token = data.idToken;
        const delegate = this._streamPromises.get(token);
        if (!delegate) {
          console.warn('Completion updated but stream absent');
        } else {
          delegate.resolve({
            done: false,
            response: {
              insertText: data.output
            }
          });
        }
        break;
      }
      case 'complete': {
        const token = data.idToken;
        const delegate = this._streamPromises.get(token);
        if (!delegate) {
          console.warn('Completion done but stream absent');
        } else {
          delegate.resolve({
            done: true,
            response: {
              insertText: data.output
            }
          });
        }
        this._streamPromises.delete(token);
        break;
      }
      case 'exception': {
        if (data.error?.message !== 'Execution interrupted') {
          Notification.error(data.error?.message);
          return;
        }
        // handle interruption
        const token = data.idToken;
        const delegate = this._streamPromises.get(token);
        if (delegate) {
          delegate.resolve({
            done: true,
            response: {
              insertText: data.output
            }
          });
        }
        this._streamPromises.delete(token);
        break;
      }
    }
  }

  async fetch(
    request: CompletionHandler.IRequest,
    context: IInlineCompletionContext
  ): Promise<IInlineCompletionList<IInlineCompletionItem>> {
    // TODO: if the debouncer is > timeout configured upstream this will fail; therefore the debouncer may be better moved upstream
    // OR providers should be able to set the timeout and upstream should use the default or provider-set timeout.
    // An argument against moving the debouncer upstream is that users may want to set different thresholds for different providers
    // e.g. the history provider always knows the answer in an instant and is free, this provider is free but your computer fan may fire up
    // and other providers may cost $$$.

    // do not even invoke the debouncer unless ready
    return await this._debouncer.invoke(request, context);
  }

  /**
   * Send a tick to the worker with number of current generation counter.
   */
  private _tickWorker() {
    Atomics.store(this._sharedArray, 0, this._currentGeneration);
    Atomics.notify(this._sharedArray, 0, 1);
  }

  private _abortPrevious() {
    this._currentGeneration++;
    this._tickWorker();
  }

  private _prefixFromRequest(request: CompletionHandler.IRequest): string {
    const textBefore = request.text.slice(0, request.offset);
    const prefix = textBefore.slice(
      -Math.min(this._settings.maxContextWindow, textBefore.length)
    );
    return prefix;
  }

  private async _fetch(
    request: CompletionHandler.IRequest,
    context: IInlineCompletionContext
  ): Promise<IInlineCompletionList<IInlineCompletionItem>> {
    await this._ready.promise;
    this._abortPrevious();
    this._streamPromises = new Map();

    const textMimeTypes = ['text/x-markdown', 'text/plain'];
    const isText = textMimeTypes.includes(request.mimeType);
    // TODO add a setting to only invoke on text if explicitly asked (triggerKind = invoke)
    const model = isText
      ? this._settings.textModel
      : this._settings.codeModel;

    const prefix = this._prefixFromRequest(request);
    const items: IInlineCompletionItem[] = [];
    const idTokens = [];
    for (let i = 0; i < this._settings.generateN; i++) {
      const token = 'T' + ++this._tokenCounter;
      idTokens.push(token);
      items.push({
        insertText: '',
        isIncomplete: true,
        token: token
      });
    }
    this._postMessage({
      model,
      text: prefix,
      maxNewTokens: this._settings.maxNewTokens,
      temperature: this._settings.temperature,
      topK: this._settings.topK,
      doSample: this._settings.doSample,
      generateN: this._settings.generateN,
      idTokens,
      action: 'generate',
      counter: this._currentGeneration
    });
    return { items };
  }

  async *stream(token: string) {
    let done = false;
    while (!done) {
      const delegate = new PromiseDelegate<IStream>();
      this._streamPromises.set(token, delegate);
      const promise = delegate.promise;
      yield promise;
      done = (await promise).done;
    }
  }

  private _postMessage(message: ClientMessage.Message) {
    this.options.worker.postMessage(message);
  }

  private _currentModels: {
    code?: string;
    text?: string;
  } = {};
  private _loadingNotifications: Record<string, string> = {};
  private _settings: ISettings = DEFAULT_SETTINGS;
  private _streamPromises: Map<string, PromiseDelegate<IStream>> = new Map();
  private _ready = new PromiseDelegate();
  private _tokenCounter = 0;
  private _debouncer = new Debouncer(
    this._fetch.bind(this),
    DEFAULT_SETTINGS.debounceMilliseconds
  );
  private _sharedArray: Int32Array;
  private _currentGeneration = 0;
}

const worker = new Worker(new URL('./worker.js', import.meta.url));

/**
 * Initialization data for the @jupyterlab/transformers-completer extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/transformers-completer:plugin',
  description: 'An in-browser AI completion provider for JupyterLab.',
  requires: [ICompletionProviderManager],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    providerManager: ICompletionProviderManager
  ) => {
    const provider = new TransformersInlineProvider({ worker });
    providerManager.registerInlineProvider(provider);
  }
};

export default plugin;

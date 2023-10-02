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

interface ISettings {
  temperature: number;
  model: string;
  maxNewTokens: number;
  topK: number;
  doSample: boolean;
  generateN: number;
  debounceMilliseconds: number;
}

const DEFAULT_SETTINGS: ISettings = {
  model: 'Xenova/tiny_starcoder_py',
  temperature: 0.5,
  doSample: false,
  topK: 5,
  maxNewTokens: 50,
  generateN: 2,
  debounceMilliseconds: 0
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
    this._bufferArrayWrapper = new Int32Array(buffer);
    options.worker.postMessage({
      action: 'initializeBuffer',
      buffer: buffer
    });
    options.worker.addEventListener(
      'message',
      this.onMessageReceived.bind(this)
    );
  }

  readonly identifier = '@krassowski/inline-completer';
  readonly name = 'Transformers powered completions';

  get schema(): ISettingRegistry.IProperty {
    return {
      properties: {
        model: {
          title: 'Model',
          enum: [
            // https://huggingface.co/bigcode/tiny_starcoder_py
            'Xenova/tiny_starcoder_py',
            // https://huggingface.co/Salesforce/codegen-350M-mono
            'Xenova/codegen-350M-mono',
            'Xenova/codegen-350M-multi'
            //
            // 'Xenova/starcoderbase-1b-sft',
            // 'Xenova/WizardCoder-1B-V1.0'
          ],
          type: 'string'
        },
        temperature: {
          minimum: 0,
          maximum: 1,
          type: 'number',
          title: 'Temperature',
          description: 'The value used to module the next token probabilities'
        },
        doSample: {
          type: 'boolean',
          description: 'Whether to use sampling; use greedy decoding otherwise'
        },
        topK: {
          minimum: 0,
          maximum: 50,
          type: 'number',
          title: 'Top k',
          description:
            'The number of highest probability vocabulary tokens to keep for top-k-filtering'
        },
        maxNewTokens: {
          minimum: 1,
          maximum: 512,
          type: 'number',
          title: 'Maximum number of new tokens'
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
            'Time since the last key press to start generation (debouncer) in milliseconds'
        }
      },
      default: DEFAULT_SETTINGS as any
    };
  }

  configure(settings: { [property: string]: JSONValue }): void {
    this._settings = settings as any as ISettings;
    console.log(this._settings);
    this._debouncer = new Debouncer(
      this._fetch.bind(this),
      this._settings.debounceMilliseconds ??
        DEFAULT_SETTINGS.debounceMilliseconds
    );
    this.options.worker.postMessage({
      action: 'initializeModel',
      model: this._settings.model
    });
  }

  // TODO types
  onMessageReceived(e: any) {
    console.log(e);
    const data = e.data;
    // TODO: maybe only tick on update?
    this._tickWorker();
    switch (e.data.status) {
      case 'initiate':
        this._ready = new PromiseDelegate();
        if (data.model !== this._lastModel) {
          this._notificationId = Notification.info(
            'Loading model' + data.model + ': fetching' + data.file
          );
          this._lastModel = data.model;
        }
        break;
      case 'progress':
        Notification.update({
          id: this._notificationId,
          message:
            'Loading model ' +
            data.model +
            ' ' +
            Math.round(data.progress) +
            '%',
          type: 'in-progress',
          progress: data.progress
        });
        break;

      case 'done':
        Notification.dismiss(this._notificationId);
        break;

      case 'ready':
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
        break;
      }
    }
  }

  async fetch(
    request: CompletionHandler.IRequest,
    context: IInlineCompletionContext
  ): Promise<IInlineCompletionList<IInlineCompletionItem>> {
    // do not even invoke the debouncer unless ready
    return await this._debouncer.invoke(request, context);
  }

  /**
   * Send a tick to the worker with number of current generation counter.
   */
  private _tickWorker() {
    Atomics.store(this._bufferArrayWrapper, 0, this._currentGeneration);
    Atomics.notify(this._bufferArrayWrapper, 0, 1);
  }

  private _abortPrevious() {
    this._currentGeneration++;
    this._tickWorker();
  }

  private async _fetch(
    request: CompletionHandler.IRequest,
    context: IInlineCompletionContext
  ): Promise<IInlineCompletionList<IInlineCompletionItem>> {
    await this._ready.promise;
    this._abortPrevious();
    this._streamPromises = new Map();
    const multiLinePrefix = request.text.slice(0, request.offset);
    const linePrefix = multiLinePrefix.split('\n').slice(-1)[0];
    console.log(linePrefix);
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
    this.options.worker.postMessage({
      model: this._settings.model,
      text: multiLinePrefix,
      max_new_tokens: this._settings.maxNewTokens,
      temperature: this._settings.temperature,
      top_k: this._settings.topK,
      do_sample: this._settings.doSample,
      num_return_sequences: this._settings.generateN,
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

  private _notificationId: string = '';
  private _settings: ISettings = DEFAULT_SETTINGS;
  private _streamPromises: Map<string, PromiseDelegate<IStream>> = new Map();
  private _ready = new PromiseDelegate();
  private _tokenCounter = 0;
  private _lastModel = '';
  private _debouncer = new Debouncer(
    this._fetch.bind(this),
    DEFAULT_SETTINGS.debounceMilliseconds
  );
  private _bufferArrayWrapper: Int32Array;
  private _currentGeneration = 0;
}

const worker = new Worker(new URL('./worker.js', import.meta.url));

/**
 * Initialization data for the @jupyterlab/transformers-completer extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/transformers-completer:plugin',
  description: 'A JupyterLab extension.',
  requires: [ICompletionProviderManager],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    providerManager: ICompletionProviderManager
  ) => {
    const provider = new TransformersInlineProvider({ worker });
    providerManager.registerInlineProvider(provider);
    console.log(
      'JupyterLab extension @jupyterlab/transformers-completer is activated!'
    );
  }
};

export default plugin;

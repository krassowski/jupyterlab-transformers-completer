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
import { Notification, showErrorMessage } from '@jupyterlab/apputils';
import { JSONValue, PromiseDelegate } from '@lumino/coreutils';
import type { ClientMessage, WorkerMessage, IModelSettings } from './types';
import { formatFileSize } from './utils';
import { IModelInfo, codeModels, textModels } from './models';

interface ISettings extends IModelSettings {
  codeModel: string;
  textModel: string;
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
  maxContextWindow: 512,
  diversityPenalty: 1,
  repetitionPenalty: 1
};

class TransformersInlineProvider implements IInlineCompletionProvider {
  readonly identifier = '@krassowski/inline-completer';
  readonly name = 'Transformers powered completions';

  constructor(protected options: TransformersInlineProvider.IOptions) {
    try {
      SharedArrayBuffer;
    } catch (e) {
      showErrorMessage(
        'SharedArrayBuffer not available',
        'Server extension enabling `same-origin` and `require-corp` headers is required for jupyterlab-transformers-completer to access `SharedArrayBuffer` which is used to synchronously communicate with the language model WebWorker.'
      );
    }
    const buffer = new SharedArrayBuffer(1024);
    this._sharedArray = new Int32Array(buffer);
    options.worker.addEventListener(
      'message',
      this._onMessageReceived.bind(this)
    );
    this._workerStarted.promise.then(() => {
      this._postMessage({
        action: 'initializeBuffer',
        buffer: buffer
      });
    });
  }

  get schema(): ISettingRegistry.IProperty {
    return {
      properties: {
        codeModel: {
          title: 'Code model',
          description: 'Model used in code cells and code files.',
          oneOf: [
            { const: 'none', title: 'No model' },
            ...codeModels.map(this._formatModelOptions)
          ],
          type: 'string'
        },
        textModel: {
          title: 'Text model',
          description:
            'Model used in Markdown (cells and files) and plain text files.',
          oneOf: [
            { const: 'none', title: 'No model' },
            ...textModels.map(this._formatModelOptions)
          ],
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
          title: 'Tokens limit',
          description: 'Maximum number of new tokens.'
        },
        generateN: {
          minimum: 1,
          type: 'number',
          title: 'Candidates',
          description: 'How many completion candidates should be generated.'
        },
        diversityPenalty: {
          type: 'number',
          title: 'Diversity penalty',
          description: '1.0 means not penalty.'
        },
        repetitionPenalty: {
          type: 'number',
          title: 'Repetition penalty',
          description: '1.0 means not penalty.'
        },
        // TODO: characters are a poor proxy for number of tokens when whitespace are many (though a strictly conservative one).
        // Words could be better but can be over-optimistic - one word can be several tokens).
        maxContextWindow: {
          title: 'Context window',
          minimum: 1,
          type: 'number',
          description:
            'At most how many characters should be provided to the model. Smaller context results in faster generation at a cost of less accurate suggestions.'
        }
      },
      default: DEFAULT_SETTINGS as any
    };
  }

  async configure(settings: { [property: string]: JSONValue }): Promise<void> {
    this._settings = settings as any as ISettings;
    await this._workerStarted.promise;
    this._switchModel(this._settings.codeModel, 'code');
    this._switchModel(this._settings.textModel, 'text');
  }

  async fetch(
    request: CompletionHandler.IRequest,
    context: IInlineCompletionContext
  ): Promise<IInlineCompletionList<IInlineCompletionItem>> {
    const textMimeTypes = [
      'text/x-ipythongfm',
      'text/x-markdown',
      'text/plain',
      'text/x-rst',
      'text/x-latex',
      'text/x-rsrc'
    ];
    const isText = textMimeTypes.includes(request.mimeType!);
    // TODO add a setting to only invoke on text if explicitly asked (triggerKind = invoke)
    const model = isText ? this._settings.textModel : this._settings.codeModel;

    await this._ready[model].promise;
    this._abortPrevious();
    this._streamPromises = new Map();

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
      repetitionPenalty: this._settings.repetitionPenalty,
      diversityPenalty: this._settings.diversityPenalty,
      idTokens,
      action: 'generate',
      counter: this._currentGeneration
    });
    return { items };
  }

  /**
   * Stream a reply for completion identified by given `token`.
   */
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

  /**
   * Handle message from the web worker.
   */
  private _onMessageReceived(event: MessageEvent) {
    const data = event.data;
    switch (data.status) {
      case 'worker-started':
        this._msgWorkerStarted(data as WorkerMessage.IWorkerStarted);
        break;
      case 'initiate':
        this._msgInitiate(data as WorkerMessage.IInitiate);
        break;
      case 'progress':
        this._msgProgress(data as WorkerMessage.IProgress);
        break;
      case 'done':
        this._msgDone(data as WorkerMessage.IDone);
        break;
      case 'ready':
        this._msgReady(data as WorkerMessage.IReady);
        break;
      case 'update':
        this._msgUpdate(data as WorkerMessage.IUpdate);
        break;
      case 'complete':
        this._msgComplete(data as WorkerMessage.IComplete);
        break;
      case 'interrupted':
        this._msgInterrupted(data as WorkerMessage.IGenerationError);
        break;
      case 'exception':
        this._msgException(data as WorkerMessage.IGenerationError);
        break;
    }
  }

  private _msgWorkerStarted(_data: WorkerMessage.IWorkerStarted) {
    this._workerStarted.resolve(undefined);
  }

  private _msgInitiate(data: WorkerMessage.IInitiate) {
    this._ready[data.model] = new PromiseDelegate();
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
  }

  private _msgProgress(data: WorkerMessage.IProgress) {
    Notification.update({
      id: this._loadingNotifications[data.model],
      message: `Loading ${data.model}: ${data.file} ${Math.round(
        data.progress
      )}% (${formatFileSize(data.loaded, 1)}/${formatFileSize(data.total)})`,
      type: 'in-progress',
      autoClose: false,
      progress: data.progress / 100
    });
  }

  private _msgDone(data: WorkerMessage.IDone) {
    Notification.update({
      id: this._loadingNotifications[data.model],
      message: `Loaded ${data.file} for ${data.model}, compiling...`,
      type: 'success',
      autoClose: false
    });
  }

  private _msgReady(data: WorkerMessage.IReady) {
    Notification.dismiss(this._loadingNotifications[data.model]);
    this._ready[data.model].resolve(void 0);
  }

  private _msgUpdate(data: WorkerMessage.IUpdate) {
    this._tickWorker();
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
  }

  private _msgComplete(data: WorkerMessage.IComplete) {
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
  }

  private _msgInterrupted(data: WorkerMessage.IGenerationError) {
    // handle interruption
    for (const token of data.idTokens) {
      const delegate = this._streamPromises.get(token);
      if (delegate) {
        delegate.reject(null);
      }
      this._streamPromises.delete(token);
    }
  }

  private _msgException(data: WorkerMessage.IGenerationError) {
    Notification.error(`Worker error: ${data.error?.message}`);
    console.error(data);
  }

  /**
   * Summarise model for display in user settings.
   */
  private _formatModelOptions(model: IModelInfo) {
    const modelName = model.repo.replace('Xenova/', '');
    return {
      const: model.repo,
      title: `${modelName} (${model.licence})`
    };
  }

  /**
   * Send a tick to the worker with number of current generation counter.
   */
  private _tickWorker() {
    Atomics.store(this._sharedArray, 0, this._currentGeneration);
    Atomics.notify(this._sharedArray, 0, 1);
  }

  /**
   * Communicate to the worker that previous suggestion no longer needs to be generated.
   */
  private _abortPrevious() {
    this._currentGeneration++;
    this._tickWorker();
  }

  /**
   * Extract prefix from request, accounting for context window limit.
   */
  private _prefixFromRequest(request: CompletionHandler.IRequest): string {
    const textBefore = request.text.slice(0, request.offset);
    const prefix = textBefore.slice(
      -Math.min(this._settings.maxContextWindow, textBefore.length)
    );
    return prefix;
  }

  /**
   * A type-guarded shorthand to post message to the worker.
   */
  private _postMessage(message: ClientMessage.Message) {
    this.options.worker.postMessage(message);
  }

  /**
   * Switch generative model for given `type` of content.
   */
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

  private _currentGeneration = 0;
  private _currentModels: {
    code?: string;
    text?: string;
  } = {};
  private _loadingNotifications: Record<string, string> = {};
  private _ready: Record<string, PromiseDelegate<void>> = {};
  private _settings: ISettings = DEFAULT_SETTINGS;
  private _sharedArray: Int32Array;
  private _streamPromises: Map<string, PromiseDelegate<IStream>> = new Map();
  private _tokenCounter = 0;
  private _workerStarted = new PromiseDelegate();
}

namespace TransformersInlineProvider {
  export interface IOptions {
    worker: Worker;
  }
}

interface IStream {
  done: boolean;
  response: IInlineCompletionItem;
}

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
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    const provider = new TransformersInlineProvider({ worker });
    providerManager.registerInlineProvider(provider);
  }
};

export default plugin;

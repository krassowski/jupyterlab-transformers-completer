import type { Pipeline } from '@xenova/transformers';
import type {
  transformersModule,
  ClientMessage as Message,
  WorkerMessage
} from './types';

// Note: neither importScripts nor module import worked, see:
// https://github.com/webpack/webpack/issues/16633
// https://github.com/webpack/webpack/issues/16173
// https://github.com/jupyterlab/jupyterlab/issues/10197
const transformers = (await import(
  /* webpackIgnore: true */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.2'
)) as transformersModule;

class Worker {
  async handleMessage(event: MessageEvent) {
    const data = event.data;
    switch (data.action) {
      case 'generate':
        return this._generate(data as Message.IGenerate);
      case 'configure':
        return this._configure(data as Message.IConfigure);
      case 'initializeBuffer':
        return this._initializeBuffer(data as Message.IInitializeBuffer);
      case 'initializeModel':
        return this._initializeModel(data as Message.IInitializeModel);
      case 'disposeModel':
        return this._disposeModel(data as Message.IDisposeModel);
      default:
        console.error('Unhandled message', event);
        break;
    }
  }

  private async _generate(data: Message.IGenerate) {
    const { model: modelName, text, idTokens, counter: startCounter } = data;

    const sharedArray = this._sharedArray;
    if (sharedArray === null) {
      throw Error(
        'Cannot generate before `initializeBuffer` message got processed'
      );
    }
    const model = this._initializeModel({ model: modelName });
    const generator = await model.instance;

    const generationCounter = sharedArray[0];
    if (generationCounter !== startCounter) {
      console.log('Skipping generation because new request was sent since');
      return;
    }

    let output = [];
    try {
      // see https://huggingface.co/docs/transformers.js/main/en/api/utils/generation#module_utils/generation.GenerationConfig
      output = await generator(text, {
        max_new_tokens: data.maxNewTokens,
        temperature: data.temperature,
        top_k: data.topK,
        do_sample: data.doSample,
        num_beams: data.generateN,
        num_return_sequences: data.generateN,
        repetition_penalty: data.repetitionPenalty,
        diversity_penalty: data.diversityPenalty,
        // make the alternatives more diverse
        num_beam_groups: data.generateN,
        callback_function: (x: any) => {
          const generationCounter = sharedArray[0];
          if (generationCounter !== startCounter) {
            // TODO: use `stopping_condition` once available, see
            // https://github.com/xenova/transformers.js/issues/341
            throw Error('Execution interrupted');
          }

          for (let i = 0; i < x.length; i++) {
            const output = generator.tokenizer.decode(x[i].output_token_ids, {
              skip_special_tokens: true
            });
            self.postMessage({
              status: 'update',
              output: output.substring(text.length),
              idToken: idTokens[i]
            } as WorkerMessage.IUpdate);
          }
        }
      });
    } catch (e: unknown) {
      const errorData = {
        error: {
          message: (e as Error).message
        },
        idTokens
      };
      if ((e as Error).message === 'Execution interrupted') {
        self.postMessage({
          status: 'interrupted',
          ...errorData
        } as WorkerMessage.IGenerationError);
      } else {
        self.postMessage({
          status: 'exception',
          ...errorData
        } as WorkerMessage.IGenerationError);
      }
    }

    for (let i = 0; i < output.length; i++) {
      self.postMessage({
        status: 'complete',
        output: output[i].generated_text.substring(text.length),
        idToken: idTokens[i]
      } as WorkerMessage.IComplete);
    }
  }

  private _initializeModel(data: { model: string }): CompletionModel {
    let model = this._completionModels.get(data.model);
    if (model) {
      return model;
    }
    model = new CompletionModel({
      model: data.model,
      onLoadingProgress: (progress: any) => {
        self.postMessage({
          ...progress,
          model: data.model
        } as WorkerMessage.IProgress);
      }
    });
    this._completionModels.set(data.model, model);
    return model;
  }

  private _configure(data: Message.IConfigure) {
    // Allow to download the model from the hub.
    transformers.env.allowLocalModels = data.allowLocalModels;
  }

  private _initializeBuffer(data: Message.IInitializeBuffer) {
    this._sharedArray = new Int32Array(data.buffer);
  }

  private _disposeModel(data: Message.IDisposeModel) {
    const model = this._completionModels.get(data.model);
    if (!model) {
      return;
    }
    this._completionModels.delete(data.model);
    return model.dispose();
  }

  private _sharedArray: Int32Array | null = null;
  private _completionModels: Map<string, CompletionModel> = new Map();
}

class CompletionModel {
  constructor(options: CompletionModel.IOptions) {
    this._model = options.model;
    this._instance = transformers.pipeline(this._task, this._model, {
      progress_callback: (progress: any) => {
        options.onLoadingProgress(progress);
      }
    });
  }

  get instance() {
    return this._instance;
  }

  async dispose() {
    (await this._instance).dispose();
  }

  private _instance: Promise<Pipeline>;
  private _task = 'text-generation';
  private _model: string;
}

namespace CompletionModel {
  export interface IOptions {
    model: string;
    onLoadingProgress: (progress: any) => void;
  }
}

export const worker = new Worker();
self.addEventListener('message', worker.handleMessage.bind(worker));
self.postMessage({ status: 'worker-started' } as WorkerMessage.IWorkerStarted);

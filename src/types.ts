import type { env } from '@xenova/transformers';
import type * as transformersModuleNamespace from '@xenova/transformers';
type MutableEnvironment = {
  -readonly [K in keyof typeof transformersModuleNamespace.env]: (typeof transformersModuleNamespace.env)[K];
};
export type transformersModule = {
  env: MutableEnvironment;
  pipeline: typeof transformersModuleNamespace.pipeline;
};

export interface IModelSettings {
  temperature: number;
  maxNewTokens: number;
  topK: number;
  doSample: boolean;
  repetitionPenalty: number;
  diversityPenalty: number;
  // this a default for `num_return_sequences`, `num_beams` and `num_beam_groups`.
  generateN: number;
}

export namespace ClientMessage {
  export interface IConfigure {
    action: 'configure';
    allowLocalModels: (typeof env)['allowLocalModels'];
    allowRemoteModels: (typeof env)['allowRemoteModels'];
    remoteHost: (typeof env)['remoteHost'];
    localModelPath: (typeof env)['localModelPath'];
  }
  export interface IInitializeBuffer {
    action: 'initializeBuffer';
    buffer: SharedArrayBuffer;
  }
  export interface IInitializeModel {
    action: 'initializeModel';
    model: string;
  }
  export interface IDisposeModel {
    action: 'disposeModel';
    model: string;
  }
  export interface IGenerate extends IModelSettings {
    action: 'generate';
    model: string;
    idTokens: string[];
    text: string;
    counter: number;
  }
  export type Message =
    | IConfigure
    | IInitializeBuffer
    | IInitializeModel
    | IDisposeModel
    | IGenerate;
}

export namespace WorkerMessage {
  export interface IWorkerStarted {
    status: 'worker-started';
  }
  interface IModelLoadingMessage {
    model: string;
    file: string;
  }
  export interface IInitiate extends IModelLoadingMessage {
    status: 'initiate';
  }
  export interface IProgress extends IModelLoadingMessage {
    status: 'progress';
    loaded: number;
    total: number;
    progress: number;
  }
  export interface IDone extends IModelLoadingMessage {
    status: 'done';
  }
  export interface IReady extends IModelLoadingMessage {
    status: 'ready';
  }
  interface ICompletionMessage {
    idToken: string;
    output: string;
  }
  export interface IUpdate extends ICompletionMessage {
    status: 'update';
  }
  export interface IComplete extends ICompletionMessage {
    status: 'complete';
  }
  export interface IGenerationError {
    idTokens: string[];
    error?: {
      message: string;
    };
  }
}

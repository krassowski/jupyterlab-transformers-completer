import type { env } from '@xenova/transformers';
import type * as transformersModuleNamespace from '@xenova/transformers';
type MutableEnvironment = {
  -readonly [K in keyof typeof transformersModuleNamespace.env]: (typeof transformersModuleNamespace.env)[K];
};
export type transformersModule = {
  env: MutableEnvironment;
  pipeline: typeof transformersModuleNamespace.pipeline;
};

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
  export interface IGenerate {
    action: 'generate';
    model: string;
    idTokens: string[];
    text: string;
    maxNewTokens: number;
    temperature: number;
    topK: number;
    doSample: boolean;
    generateN: number;
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
  // TODO
}

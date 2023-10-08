export interface IModelInfo {
  repo: string;
  licence: string;
  humanEval?: number;
}

/**
 * To update the list of models, compare with:
 * https://huggingface.co/models?pipeline_tag=text-generation&library=transformers.js
 */
export const codeModels: IModelInfo[] = [
  {
    repo: 'Xenova/tiny_starcoder_py',
    licence: 'bigcode-openrail-m',
    humanEval: 7.84
  },
  {
    repo: 'Xenova/codegen-350M-mono',
    licence: 'bsd-3-clause'
  },
  {
    repo: 'Xenova/codegen-350M-multi',
    licence: 'bsd-3-clause'
  },
  {
    repo: 'Xenova/starcoderbase-1b-sft',
    licence: '???',
    humanEval: 39
  },
  {
    repo: 'Xenova/WizardCoder-1B-V1.0',
    licence: 'bigcode-openrail-m',
    humanEval: 23.8
  },
  {
    repo: 'Xenova/J-350M',
    licence: 'bsd-3-clause'
  }
];

export const textModels: IModelInfo[] = [
  {
    repo: 'Xenova/gpt2',
    licence: 'mit'
  },
  {
    repo: 'Xenova/TinyLLama-v0',
    licence: 'apache-2.0'
  },
  {
    repo: 'Xenova/dlite-v2-774m',
    licence: 'apache-2.0'
  },
  {
    repo: 'Xenova/LaMini-GPT-124M',
    licence: 'cc-by-nc-4.0'
  },
  {
    repo: 'Xenova/LaMini-Cerebras-111M',
    licence: 'cc-by-nc-4.0'
  },
  {
    repo: 'Xenova/LaMini-Cerebras-256M',
    licence: 'cc-by-nc-4.0'
  },
  {
    repo: 'Xenova/LaMini-Cerebras-590M',
    licence: 'cc-by-nc-4.0'
  },
  {
    repo: 'Xenova/opt-125m',
    licence: 'other'
  },
  {
    repo: 'Xenova/pythia-70m-deduped',
    licence: 'apache-2.0'
  },
  {
    repo: 'Xenova/distilgpt2',
    licence: 'apache-2.0'
  },
  {
    repo: 'Xenova/llama-160m',
    licence: 'other'
  }
];

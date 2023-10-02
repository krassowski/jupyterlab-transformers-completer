// Apache-2.0 license
// Based on code by Joshua Lochner
import type { Pipeline } from '@xenova/transformers';
import type * as transformersModuleNamespace from '@xenova/transformers';
type transformersModuleType = {
  env: typeof transformersModuleNamespace.env;
  pipeline: typeof transformersModuleNamespace.pipeline;
};

/**
 * This class uses the Singleton pattern to ensure that only one instance of the pipeline is loaded.
 */
class CodeCompletionPipeline {
  static task = 'text-generation';
  static model?: string;
  static instance?: Promise<Pipeline>;

  static async getInstance(
    progress_callback?: (message: any) => void
  ): Promise<Pipeline> {
    // note: neither importScripts nor module import worked, see:
    // https://github.com/webpack/webpack/issues/16633
    // https://github.com/webpack/webpack/issues/16173
    const transformers = (await import(
      /* webpackIgnore: true */
      // @ts-ignore
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.2'
    )) as transformersModuleType;

    // @ts-ignore
    transformers.env.allowLocalModels = false;

    if (!this.instance) {
      this.instance = transformers.pipeline(this.task, this.model, {
        progress_callback
      });
    }

    return this.instance;
  }
}

// Listen for messages from the main thread
self.addEventListener('message', async event => {
  const {
    model,
    text,
    max_new_tokens,

    // Generation parameters
    temperature,
    top_k,
    do_sample,
    num_return_sequences,
    idTokens,
    action
  } = event.data;

  if (CodeCompletionPipeline.model !== model) {
    // Invalidate model if different
    CodeCompletionPipeline.model = model;

    const instance = CodeCompletionPipeline.instance;
    if (instance) {
      (await instance).dispose();
      CodeCompletionPipeline.instance = undefined;
    }
  }

  // Retrieve the code-completion pipeline. When called for the first time,
  // this will load the pipeline and save it for future use.
  const generator = await CodeCompletionPipeline.getInstance(x => {
    // We also add a progress callback to the pipeline so that we can
    // track model loading.
    self.postMessage({ ...x, model });
  });

  if (action !== 'generate') {
    return;
  }

  // Actually perform the code-completion
  const output = await generator(text, {
    max_new_tokens,
    temperature,
    top_k,
    do_sample,
    num_beams: num_return_sequences,
    num_return_sequences,
    // Allows for partial output
    callback_function: (x: any) => {
      for (let i = 0; i < x.length; i++) {
        const output = generator.tokenizer.decode(x[i].output_token_ids, {
          skip_special_tokens: true
        });
        self.postMessage({
          status: 'update',
          output: output.substring(text.length),
          idToken: idTokens[i]
        });
      }
    }
  });

  // Send the output back to the main thread
  for (let i = 0; i < output.length; i++) {
    self.postMessage({
      status: 'complete',
      output: output[i].generated_text.substring(text.length),
      idToken: idTokens[i]
    });
  }
});
